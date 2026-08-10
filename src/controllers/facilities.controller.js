const axios = require('axios');
const Facility = require('../models/Facility');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// ─── TTL cache (15 min) — avoids hammering Overpass on repeat searches ────────
const _cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  _cache.set(key, { data, exp: Date.now() + CACHE_TTL });
}

// ─── OpenStreetMap type mappings ──────────────────────────────────────────────

const OSM_TO_OUR_TYPE = {
  hospital:    'hospital',
  clinic:      'clinic',
  doctors:     'clinic',
  dentist:     'clinic',
  health_post: 'clinic',
  pharmacy:    'pharmacy',
  laboratory:  'lab',
};

// Our type filter → the OSM amenity values to include
const OUR_TO_OSM_AMENITIES = {
  hospital:  'hospital',
  clinic:    'clinic|doctors|dentist|health_post',
  pharmacy:  'pharmacy',
  lab:       'laboratory',
  emergency: 'hospital',
  '':        'hospital|clinic|pharmacy|doctors|laboratory|dentist|health_post',
};

// ─── Overpass API query ───────────────────────────────────────────────────────

async function fetchOSMNearby(lat, lng, radiusMetres, ourType) {
  const amenityRegex = OUR_TO_OSM_AMENITIES[ourType || ''] ?? OUR_TO_OSM_AMENITIES[''];

  const cacheKey = `osm:${Number(lat).toFixed(3)},${Number(lng).toFixed(3)},${radiusMetres},${ourType}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Overpass QL — fetch both nodes and ways, return way centroids
  const query =
    `[out:json][timeout:20];` +
    `(` +
    `node["amenity"~"${amenityRegex}"](around:${radiusMetres},${lat},${lng});` +
    `way["amenity"~"${amenityRegex}"](around:${radiusMetres},${lat},${lng});` +
    `);` +
    `out center;`;

  try {
    const { data } = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20_000 }
    );

    const results = (data.elements || [])
      .filter(el => el.tags?.name) // skip unnamed places
      .map(el => {
        const elLat = el.lat  ?? el.center?.lat;
        const elLng = el.lon  ?? el.center?.lon;
        if (!elLat || !elLng) return null;

        const amenity = el.tags.amenity;
        const address = [
          el.tags['addr:housenumber'],
          el.tags['addr:street'],
          el.tags['addr:city'] || el.tags['addr:state'],
        ].filter(Boolean).join(', ') || el.tags['addr:full'] || el.tags.description || '';

        return {
          _id:            `osm_${el.type}_${el.id}`,
          name:           el.tags.name,
          type:           OSM_TO_OUR_TYPE[amenity] || 'clinic',
          address,
          location:       { type: 'Point', coordinates: [elLng, elLat] },
          phone:          el.tags.phone || el.tags['contact:phone'] || null,
          website:        el.tags.website || el.tags['contact:website'] || null,
          operatingHours: el.tags.opening_hours || null,
          isVerified:     false,
          _source:        'osm',
        };
      })
      .filter(Boolean);

    cacheSet(cacheKey, results);
    return results;
  } catch (err) {
    console.error('[Overpass] error:', err.message);
    return [];
  }
}

// ─── Merge: DB (verified) first, OSM fills the rest ──────────────────────────

function mergeResults(dbList, osmList, limit = 30) {
  const seen = new Set(dbList.map(f => f.name.toLowerCase().trim()));
  const fresh = osmList.filter(f => !seen.has(f.name.toLowerCase().trim()));
  return [...dbList, ...fresh].slice(0, limit);
}

// ─── Controllers ──────────────────────────────────────────────────────────────

exports.create = asyncHandler(async (req, res, next) => {
  const { name, type, address, lat, lng, phone, email, website, operatingHours, services } = req.body;
  if (!lat || !lng) return next(new AppError('Coordinates (lat, lng) required.', 400));

  const facility = await Facility.create({
    name, type, address, phone, email, website, operatingHours, services,
    location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
  });
  sendSuccess(res, 201, 'Facility created.', { facility });
});

exports.getNearby = asyncHandler(async (req, res, next) => {
  const { lat, lng, radius = 5000, type } = req.query;
  if (!lat || !lng) return next(new AppError('lat and lng query params required.', 400));

  const numLat    = Number(lat);
  const numLng    = Number(lng);
  const numRadius = Number(radius);

  // Admin-verified facilities from MongoDB
  const dbFilter = {
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [numLng, numLat] },
        $maxDistance: numRadius,
      },
    },
  };
  if (type) dbFilter.type = type;

  const [dbFacilities, osmFacilities] = await Promise.all([
    Facility.find(dbFilter).limit(20).lean(),
    fetchOSMNearby(numLat, numLng, numRadius, type || ''),
  ]);

  const facilities = mergeResults(dbFacilities, osmFacilities);
  sendSuccess(res, 200, 'Nearby facilities retrieved.', { facilities, count: facilities.length });
});

exports.getEmergency = asyncHandler(async (req, res, next) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return next(new AppError('lat and lng query params required.', 400));

  const numLat = Number(lat);
  const numLng = Number(lng);

  const dbFacilities = await Facility.find({
    type: { $in: ['emergency', 'hospital'] },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [numLng, numLat] },
        $maxDistance: 20000,
      },
    },
  }).limit(5).lean();

  if (dbFacilities.length >= 3) {
    return sendSuccess(res, 200, 'Emergency facilities retrieved.', { facilities: dbFacilities });
  }

  const osmHospitals = await fetchOSMNearby(numLat, numLng, 20000, 'emergency');
  const facilities   = mergeResults(dbFacilities, osmHospitals, 5);
  sendSuccess(res, 200, 'Emergency facilities retrieved.', { facilities });
});

exports.getOne = asyncHandler(async (req, res, next) => {
  const facility = await Facility.findById(req.params.id);
  if (!facility) return next(new AppError('Facility not found.', 404));
  sendSuccess(res, 200, 'Facility retrieved.', { facility });
});

exports.update = asyncHandler(async (req, res, next) => {
  const { lat, lng, ...rest } = req.body;
  const updates = { ...rest };
  if (lat && lng) updates.location = { type: 'Point', coordinates: [Number(lng), Number(lat)] };

  const facility = await Facility.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!facility) return next(new AppError('Facility not found.', 404));
  sendSuccess(res, 200, 'Facility updated.', { facility });
});

exports.list = asyncHandler(async (req, res) => {
  const { type, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (type) filter.type = type;
  const facilities = await Facility.find(filter)
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Facility.countDocuments(filter);
  sendSuccess(res, 200, 'Facilities retrieved.', { facilities, total });
});
