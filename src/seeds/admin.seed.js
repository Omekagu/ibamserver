/**
 * Ensures a super-admin user, default specializations, platform services,
 * and subscription plans exist. Safe to call on every server start.
 * Can also be run standalone: node src/seeds/admin.seed.js
 */
const User = require('../models/User')
const Specialization = require('../models/Specialization')
const PlatformService = require('../models/PlatformService')
const SubscriptionPlan = require('../models/SubscriptionPlan')
const LabTest = require('../models/LabTest')
const WellnessPackage = require('../models/WellnessPackage')

// ─── Admin ────────────────────────────────────────────────────────────────────
async function seedAdmin () {
  const existing = await User.findOne({ role: 'admin' })
  if (existing) {
    console.log(`[seed] Admin already exists → ${existing.email}`)
    return
  }
  const admin = await User.create({
    name: 'Super Admin',
    email: process.env.ADMIN_EMAIL || 'admin@ibamhealth.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
    role: 'admin',
    isVerified: true,
    isActive: true
  })
  console.log(`[seed] ✅ Admin created → ${admin.email}`)
}

// ─── Specializations ──────────────────────────────────────────────────────────
const DEFAULT_SPECIALIZATIONS = [
  'General Practice',
  'Internal Medicine',
  'Paediatrics',
  'OB-GYN',
  'Cardiology',
  'Dermatology',
  'Psychiatry',
  'Orthopaedics',
  'ENT',
  'Ophthalmology',
  'Neurology',
  'Surgery',
  'Radiology',
  'Pathology',
  'Anaesthesia',
  'Dentistry',
  'Family Medicine',
  'Emergency Medicine',
  'Other'
]

async function seedSpecializations () {
  const count = await Specialization.countDocuments()
  if (count > 0) {
    console.log('[seed] Specializations already seeded.')
    return
  }
  await Specialization.insertMany(
    DEFAULT_SPECIALIZATIONS.map((name, i) => ({ name, order: i }))
  )
  console.log(
    `[seed] ✅ ${DEFAULT_SPECIALIZATIONS.length} specializations seeded.`
  )
}

// ─── Platform services ────────────────────────────────────────────────────────
const DEFAULT_SERVICES = [
  {
    iconName: 'video',
    tagLabel: 'Video & Audio',
    order: 0,
    title: 'Telemedicine Consultations',
    description:
      'See a verified Nigerian doctor from anywhere in the country. Our secure video and audio consultations let you describe your symptoms, get examined, and receive clinical guidance — all without leaving home.',
    steps: [
      'Choose from hundreds of specialists by specialty, rating, and price',
      'Book an immediate or scheduled consultation slot',
      'Join the encrypted video call at the agreed time',
      'Receive clinical notes and any prescriptions within minutes'
    ],
    visualLabel: 'Video Consultation',
    visualSub:
      'Encrypted end-to-end. Works on 3G. No app download required for patients.',
    cta: 'Find a Doctor',
    ctaHref: '/doctors'
  },
  {
    iconName: 'ai',
    tagLabel: 'AI-Powered',
    order: 1,
    title: 'Smart Triage System',
    description:
      'Not sure if you need a doctor? Our AI-powered triage tool analyses your symptoms against clinical guidelines and either reassures you with self-care advice or escalates to the right specialist immediately.',
    steps: [
      'Describe your symptoms in plain English or Pidgin',
      'The system asks follow-up questions to assess severity',
      'Receive a triage outcome: self-care, GP, or emergency',
      'If escalated, get directly connected to the right doctor'
    ],
    visualLabel: 'AI Symptom Checker',
    visualSub:
      'Trained on Nigerian epidemiological data. Supports English, Yoruba, Hausa, Igbo.',
    cta: 'Try Triage',
    ctaHref: '/signup'
  },
  {
    iconName: 'lab',
    tagLabel: 'Diagnostics',
    order: 2,
    title: 'Lab Tests & Diagnostics',
    description:
      'Book over 200 laboratory tests from accredited diagnostic centres across Nigeria — or request home sample collection. Results are shared securely with your doctor and stored in your health record.',
    steps: [
      'Search for the test you need or let a doctor order it for you',
      'Choose a nearby lab or schedule home sample collection',
      'Samples are collected and processed by accredited labs',
      'Results are available in your app within 24–48 hours'
    ],
    visualLabel: 'Lab Diagnostics',
    visualSub: 'NAFDAC-accreditedlabs. Results always stay private.',
    cta: 'Book a Test',
    ctaHref: '/signup'
  },
  {
    iconName: 'pharmacy',
    tagLabel: 'E-Prescriptions',
    order: 3,
    title: 'E-Prescriptions & Pharmacy',
    description:
      'Every iBam consultation ends with a digitally signed e-prescription that your pharmacy can verify instantly. Use our in-app pharmacy delivery to receive your medications same day.',
    steps: [
      'Receive your e-prescription at the end of every consultation',
      'Share with any pharmacy or use our in-app delivery service',
      'Track your delivery in real time from pharmacy to door',
      'Prescription history is saved permanently in your health record'
    ],
    visualLabel: 'E-Prescription',
    visualSub:
      'Tamper-proof digital prescriptions. Accepted by over 500 partner pharmacies.',
    cta: 'Order Medicines',
    ctaHref: '/signup'
  },
  {
    iconName: 'hospital',
    tagLabel: 'Facilities',
    order: 4,
    title: 'Hospital & Clinic Locator',
    description:
      'Find accredited hospitals, clinics, and specialist centres nearest to you. Filter by specialty, insurance acceptance, opening hours, and patient ratings.',
    steps: [
      'Enter your location or allow GPS access',
      'Filter by specialty, distance, or insurance plan',
      'View verified facility profiles with contact details',
      'Book an in-person appointment directly from the app'
    ],
    visualLabel: 'Facility Finder',
    visualSub: 'Over 1,200 verified facilities across all 36 states.',
    cta: 'Find Facilities',
    ctaHref: '/signup'
  },
  {
    iconName: 'truck',
    tagLabel: 'Delivery',
    order: 5,
    title: 'Pharmacy Delivery',
    description:
      'Order prescription and over-the-counter medications from verified pharmacies near you. Same-day delivery available in Lagos, Abuja, and Port Harcourt.',
    steps: [
      'Upload a prescription or shop OTC medications directly',
      'Select a partner pharmacy and choose delivery speed',
      'A verified dispatch rider picks up your order',
      'Track delivery live and receive in as little as 2 hours'
    ],
    visualLabel: 'Medicine Delivery',
    visualSub:
      'Same-day delivery in major cities. Cold-chain logistics for temperature-sensitive drugs.',
    cta: 'Order Now',
    ctaHref: '/signup'
  }
]

async function seedServices () {
  const count = await PlatformService.countDocuments()
  if (count > 0) {
    console.log('[seed] Platform services already seeded.')
    return
  }
  await PlatformService.insertMany(DEFAULT_SERVICES)
  console.log(`[seed] ✅ ${DEFAULT_SERVICES.length} platform services seeded.`)
}

// ─── Subscription plans ───────────────────────────────────────────────────────
const DEFAULT_PLANS = [
  {
    name: 'Free',
    description: 'Get started with basic healthcare access.',
    price: 0,
    interval: 'monthly',
    featured: false,
    features: [
      'Smart symptom triage',
      '1 consultation per month',
      'Basic health profile'
    ]
  },
  {
    name: 'Personal',
    description: 'Unlimited access to all core health services.',
    price: 2500,
    interval: 'monthly',
    featured: true,
    features: [
      'Smart symptom triage',
      'Unlimited consultations',
      'E-prescriptions',
      'Lab test ordering',
      'Pharmacy delivery',
      'Full health record storage',
      'Prescription history'
    ]
  },
  {
    name: 'Family',
    description: 'Cover your entire household under one plan.',
    price: 5000,
    interval: 'monthly',
    featured: false,
    features: [
      'Everything in Personal',
      'Up to 6 family members',
      'Shared health dashboard',
      'Priority appointment booking',
      '24/7 on-call support'
    ]
  },
  {
    name: 'Corporate',
    description: 'Enterprise healthcare for your workforce.',
    price: 0,
    interval: 'monthly',
    featured: false,
    features: [
      'Unlimited employees',
      'Dedicated care manager',
      'NHIS/HMO billing integration',
      'Usage analytics dashboard',
      'Custom onboarding'
    ]
  }
]

async function seedPlans () {
  const count = await SubscriptionPlan.countDocuments()
  if (count > 0) {
    console.log('[seed] Subscription plans already seeded.')
    return
  }
  await SubscriptionPlan.insertMany(DEFAULT_PLANS)
  console.log(`[seed] ✅ ${DEFAULT_PLANS.length} subscription plans seeded.`)
}

// ─── Lab test catalog ─────────────────────────────────────────────────────────
// Prices sourced from iBam Health General Patient Price List (official).
const DEFAULT_LAB_TESTS = [
  // HAEMATOLOGY & SOME ROUTINE TESTS
  { name: 'Full Blood Count (FBC)',                     category: 'Haematology',         walkInPrice: 10000, homeVisitPrice: 13500, estimatedPrice: 10000, turnaroundHours: 24, order: 1  },
  { name: 'Haemoglobin (Blood Level)',                  category: 'Haematology',         walkInPrice:  5000, homeVisitPrice:  8500, estimatedPrice:  5000, turnaroundHours: 12, order: 2  },
  { name: 'PCV (Blood Percentage)',                     category: 'Haematology',         walkInPrice:  5000, homeVisitPrice:  8500, estimatedPrice:  5000, turnaroundHours: 12, order: 3  },
  { name: 'Blood Film Only',                            category: 'Haematology',         walkInPrice: 10000, homeVisitPrice: 13500, estimatedPrice: 10000, turnaroundHours: 24, order: 4  },
  { name: 'ESR',                                        category: 'Haematology',         walkInPrice:  5000, homeVisitPrice:  8500, estimatedPrice:  5000, turnaroundHours: 12, order: 5  },
  { name: 'Platelet',                                   category: 'Haematology',         walkInPrice:  5000, homeVisitPrice:  8500, estimatedPrice:  5000, turnaroundHours: 12, order: 6  },
  { name: 'Blood Grouping',                             category: 'Haematology',         walkInPrice:  5000, homeVisitPrice:  8500, estimatedPrice:  5000, turnaroundHours:  6, order: 24 },
  { name: 'Genotype',                                   category: 'Haematology',         walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours:  6, order: 25 },
  { name: 'Clotting Profile',                           category: 'Haematology',         walkInPrice: 30000, homeVisitPrice: 33500, estimatedPrice: 30000, turnaroundHours: 24, order: 21 },
  { name: 'Prothrombin Time',                           category: 'Haematology',         walkInPrice: 17000, homeVisitPrice: 20500, estimatedPrice: 17000, turnaroundHours: 24, order: 22 },
  { name: 'Coagulation Profile (PT/INR, APTT)',         category: 'Haematology',         walkInPrice: 30000, homeVisitPrice: 33500, estimatedPrice: 30000, turnaroundHours: 24, order: 23 },

  // ROUTINE / SEROLOGY
  { name: 'Malaria Parasite',                           category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours: 12, order: 7  },
  { name: 'Widal Test (Typhoid)',                       category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours: 24, order: 8  },
  { name: 'Occult Blood Test',                          category: 'Serology',            walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours: 12, order: 11 },
  { name: 'H. Pylori Antibody Test',                   category: 'Serology',            walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours: 24, order: 12 },
  { name: 'HIV 1&2 Screening Test (RVS)',               category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours: 24, order: 13 },
  { name: 'HIV 1&2 Confirmatory Test (P24 Antigen)',    category: 'Serology',            walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours: 48, order: 14 },
  { name: 'Syphilis (VDRL)',                            category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours: 24, order: 15 },
  { name: 'Hepatitis B or C',                           category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours: 24, order: 16 },
  { name: 'Hepatitis B 5-Panel Test',                   category: 'Serology',            walkInPrice: 30000, homeVisitPrice: 33500, estimatedPrice: 30000, turnaroundHours: 48, order: 17 },
  { name: 'Chlamydia Screening',                        category: 'Serology',            walkInPrice: 15000, homeVisitPrice: 18500, estimatedPrice: 15000, turnaroundHours: 48, order: 18 },
  { name: 'Filarial Parasite',                          category: 'Serology',            walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours: 24, order: 19 },
  { name: 'Pregnancy Test – Blood',                     category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours:  6, order: 20 },
  { name: 'Pregnancy Test – Urine',                     category: 'Serology',            walkInPrice:  3500, homeVisitPrice:  7000, estimatedPrice:  3500, turnaroundHours:  2, order: 201},
  { name: 'Rheumatoid Factor',                          category: 'Serology',            walkInPrice:  9000, homeVisitPrice: 12500, estimatedPrice:  9000, turnaroundHours: 24, order: 56 },
  { name: 'ASO Titre',                                  category: 'Serology',            walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours: 24, order: 57 },
  { name: 'HSV',                                        category: 'Serology',            walkInPrice: 25000, homeVisitPrice: 28500, estimatedPrice: 25000, turnaroundHours: 48, order: 70 },
  { name: 'HPV',                                        category: 'Serology',            walkInPrice: 35000, homeVisitPrice: 38500, estimatedPrice: 35000, turnaroundHours: 48, order: 71 },
  { name: 'ECS',                                        category: 'Serology',            walkInPrice: 10000, homeVisitPrice: 13500, estimatedPrice: 10000, turnaroundHours: 24, order: 72 },

  // ROUTINE
  { name: 'Urinalysis',                                 category: 'Routine',             walkInPrice:  5000, homeVisitPrice:  8500, estimatedPrice:  5000, turnaroundHours: 12, order: 9  },
  { name: 'Stool Microscopy',                           category: 'Routine',             walkInPrice:  5500, homeVisitPrice:  9000, estimatedPrice:  5500, turnaroundHours: 24, order: 10 },

  // CULTURES & MICROBIOLOGY
  { name: 'Urine Culture (M/C/S)',                      category: 'Microbiology',        walkInPrice:  7000, homeVisitPrice: 10500, estimatedPrice:  7000, turnaroundHours: 72, order: 26 },
  { name: 'HVS M/C/S & Other Surface Swabs',           category: 'Microbiology',        walkInPrice:  7000, homeVisitPrice: 10500, estimatedPrice:  7000, turnaroundHours: 72, order: 27 },
  { name: 'Wound Swab & Other Surface Swabs',           category: 'Microbiology',        walkInPrice:  7000, homeVisitPrice: 10500, estimatedPrice:  7000, turnaroundHours: 72, order: 28 },
  { name: 'Urethra Smear (M/C/S)',                      category: 'Microbiology',        walkInPrice:  7000, homeVisitPrice: 10500, estimatedPrice:  7000, turnaroundHours: 72, order: 29 },
  { name: 'Stool Culture (M/C/S)',                      category: 'Microbiology',        walkInPrice:  9000, homeVisitPrice: 12500, estimatedPrice:  9000, turnaroundHours: 72, order: 30 },
  { name: 'Blood Culture',                              category: 'Microbiology',        walkInPrice: 30000, homeVisitPrice: 33500, estimatedPrice: 30000, turnaroundHours: 72, order: 31 },
  { name: 'Semen Analysis & Culture',                   category: 'Microbiology',        walkInPrice: 15000, homeVisitPrice: 18500, estimatedPrice: 15000, turnaroundHours: 48, order: 32 },
  { name: 'Semen Analysis Only',                        category: 'Microbiology',        walkInPrice:  7000, homeVisitPrice: 10500, estimatedPrice:  7000, turnaroundHours: 48, order: 33 },
  { name: 'Skin Snip',                                  category: 'Microbiology',        walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours: 48, order: 34 },
  { name: 'Sputum Microscopy Only',                     category: 'Microbiology',        walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours: 24, order: 35 },
  { name: 'Sputum M/C/S',                              category: 'Microbiology',        walkInPrice: 10000, homeVisitPrice: 13500, estimatedPrice: 10000, turnaroundHours: 72, order: 36 },
  { name: 'Sputum AFB x1x2x3',                         category: 'Microbiology',        walkInPrice: 15000, homeVisitPrice: 18500, estimatedPrice: 15000, turnaroundHours: 72, order: 37 },
  { name: 'Mantoux Test',                               category: 'Microbiology',        walkInPrice:  5500, homeVisitPrice:  9000, estimatedPrice:  5500, turnaroundHours: 72, order: 38 },
  { name: 'CSF M/C/S and Cell Count',                  category: 'Microbiology',        walkInPrice: 22000, homeVisitPrice: 25500, estimatedPrice: 22000, turnaroundHours: 72, order: 39 },
  { name: 'Ascitic Fluid M/C/S',                       category: 'Microbiology',        walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours: 72, order: 40 },
  { name: 'Fungal Studies',                             category: 'Microbiology',        walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours: 72, order: 41 },

  // CHEMICAL PATHOLOGY / CLINICAL CHEMISTRY
  { name: 'Serum Electrolytes, Urea & Creatinine (SEUCr) – Each', category: 'Biochemistry', walkInPrice:  5500, homeVisitPrice:  9000, estimatedPrice:  5500, turnaroundHours: 24, order: 42 },
  { name: 'Electrolytes Only (Na, K, Cl, HCO3, pH, iCa)',         category: 'Biochemistry', walkInPrice: 15000, homeVisitPrice: 18500, estimatedPrice: 15000, turnaroundHours: 24, order: 43 },
  { name: 'Urea & Creatinine Only',                    category: 'Biochemistry',        walkInPrice:  9000, homeVisitPrice: 12500, estimatedPrice:  9000, turnaroundHours: 24, order: 44 },
  { name: 'Liver Function Test (LFT)',                  category: 'Biochemistry',        walkInPrice: 15000, homeVisitPrice: 18500, estimatedPrice: 15000, turnaroundHours: 24, order: 45 },
  { name: 'Lipid Profile',                              category: 'Biochemistry',        walkInPrice: 15000, homeVisitPrice: 18500, estimatedPrice: 15000, turnaroundHours: 24, order: 46 },
  { name: 'Cholesterol',                                category: 'Biochemistry',        walkInPrice:  7000, homeVisitPrice: 10500, estimatedPrice:  7000, turnaroundHours: 24, order: 47 },
  { name: 'Uric Acid',                                  category: 'Biochemistry',        walkInPrice:  8000, homeVisitPrice: 11500, estimatedPrice:  8000, turnaroundHours: 24, order: 48 },
  { name: 'Serum Protein',                              category: 'Biochemistry',        walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours: 24, order: 49 },
  { name: 'Bilirubin (Total & Conjugated)',             category: 'Biochemistry',        walkInPrice:  9000, homeVisitPrice: 12500, estimatedPrice:  9000, turnaroundHours: 24, order: 50 },
  { name: 'Blood Sugar',                                category: 'Biochemistry',        walkInPrice:  2500, homeVisitPrice:  6000, estimatedPrice:  2500, turnaroundHours:  6, order: 51 },
  { name: '2HPP Glucose Test',                          category: 'Biochemistry',        walkInPrice:  4500, homeVisitPrice:  8000, estimatedPrice:  4500, turnaroundHours:  6, order: 52 },
  { name: 'OGTT (x5) Glucose Tolerance Test',          category: 'Biochemistry',        walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours:  6, order: 53 },
  { name: 'CSF Chemistry (Sugar & Protein)',            category: 'Biochemistry',        walkInPrice:  9000, homeVisitPrice: 12500, estimatedPrice:  9000, turnaroundHours: 24, order: 54 },
  { name: 'Calcium & Inorganic Phosphate',              category: 'Biochemistry',        walkInPrice: 11000, homeVisitPrice: 14500, estimatedPrice: 11000, turnaroundHours: 24, order: 55 },
  { name: 'PSA Total',                                  category: 'Biochemistry',        walkInPrice: 14000, homeVisitPrice: 17500, estimatedPrice: 14000, turnaroundHours: 48, order: 58 },
  { name: 'fPSA',                                       category: 'Biochemistry',        walkInPrice: 17000, homeVisitPrice: 20500, estimatedPrice: 17000, turnaroundHours: 48, order: 581},
  { name: 'Alpha-Feto Protein (AFP)',                   category: 'Biochemistry',        walkInPrice: 17000, homeVisitPrice: 20500, estimatedPrice: 17000, turnaroundHours: 48, order: 68 },
  { name: 'C-Reactive Protein (CRP)',                   category: 'Biochemistry',        walkInPrice: 17000, homeVisitPrice: 20500, estimatedPrice: 17000, turnaroundHours: 24, order: 69 },

  // HORMONAL / ENDOCRINOLOGY
  { name: 'FSH, LH, Prolactin & Progesterone (Female)', category: 'Endocrinology',     walkInPrice: 45000, homeVisitPrice: 48500, estimatedPrice: 45000, turnaroundHours: 48, order: 59 },
  { name: 'FSH, LH, Prolactin, Progesterone & Estradiol (E2)', category: 'Endocrinology', walkInPrice: 55000, homeVisitPrice: 58500, estimatedPrice: 55000, turnaroundHours: 48, order: 60 },
  { name: 'FSH, LH, Prolactin & Progesterone (Male)',   category: 'Endocrinology',      walkInPrice: 45000, homeVisitPrice: 48500, estimatedPrice: 45000, turnaroundHours: 48, order: 61 },
  { name: 'Testosterone',                               category: 'Endocrinology',      walkInPrice: 14000, homeVisitPrice: 17500, estimatedPrice: 14000, turnaroundHours: 48, order: 62 },
  { name: 'Prolactin',                                  category: 'Endocrinology',      walkInPrice: 14000, homeVisitPrice: 17500, estimatedPrice: 14000, turnaroundHours: 48, order: 63 },
  { name: 'Progesterone',                               category: 'Endocrinology',      walkInPrice: 14000, homeVisitPrice: 17500, estimatedPrice: 14000, turnaroundHours: 48, order: 64 },
  { name: 'Thyroid Function Test (TSH, T3, T4)',        category: 'Endocrinology',      walkInPrice: 35000, homeVisitPrice: 38500, estimatedPrice: 35000, turnaroundHours: 48, order: 65 },
  { name: 'TSH or T3 or T4 or Free T3 or Free T4 – Each', category: 'Endocrinology',  walkInPrice: 14000, homeVisitPrice: 17500, estimatedPrice: 14000, turnaroundHours: 48, order: 66 },
  { name: 'HbA1C (Glycated Haemoglobin)',               category: 'Endocrinology',      walkInPrice: 14000, homeVisitPrice: 17500, estimatedPrice: 14000, turnaroundHours: 48, order: 67 },
]

async function seedLabTests () {
  const count = await LabTest.countDocuments()
  if (count > 0) {
    console.log('[seed] Lab tests already seeded.')
    return
  }
  await LabTest.insertMany(DEFAULT_LAB_TESTS)
  console.log(`[seed] ✅ ${DEFAULT_LAB_TESTS.length} lab tests seeded.`)
}

// ─── Wellness packages ────────────────────────────────────────────────────────
// Prices sourced from iBam Health Premium Wellness Packages (official).
const DEFAULT_WELLNESS_PACKAGES = [
  {
    name: 'Men Full Body Wellness Check',
    slug: 'men-full-body-wellness',
    gender: 'male',
    targetAudience: 'Adult men seeking a convenient, broad routine health assessment, especially those who have not had a comprehensive check recently.',
    benefits: 'Provides a broad picture of blood health, glucose control, cardiovascular risk, liver and kidney function, urinary health, prostate-related screening and selected infectious-disease status.',
    includedTests: [
      'Full Blood Count (FBC)', 'Blood Sugar', 'HbA1C (Glycated Haemoglobin)',
      'Lipid Profile', 'Liver Function Test (LFT)', 'Urea & Creatinine Only',
      'Urinalysis', 'PSA Total', 'HIV 1&2 Screening Test (RVS)',
      'Hepatitis B or C', 'HPA', 'HSV'
    ],
    walkInPrice: 153500,
    homeVisitPrice: 157000,
    order: 0
  },
  {
    name: 'Women Full Body Wellness Check',
    slug: 'women-full-body-wellness',
    gender: 'female',
    targetAudience: 'Adult women seeking a convenient comprehensive routine health assessment.',
    benefits: 'Assesses blood health, glucose regulation, cardiovascular risk, liver and kidney function, thyroid function and selected infectious diseases.',
    includedTests: [
      'Full Blood Count (FBC)', 'Blood Sugar', 'HbA1C (Glycated Haemoglobin)',
      'Lipid Profile', 'Liver Function Test (LFT)', 'Urea & Creatinine Only',
      'Urinalysis', 'Thyroid Function Test (TSH, T3, T4)',
      'HIV 1&2 Screening Test (RVS)', 'Hepatitis B or C', 'ECS', 'HPA', 'HSV'
    ],
    walkInPrice: 178500,
    homeVisitPrice: 182000,
    order: 1
  },
  {
    name: 'Men Sexual Health Check',
    slug: 'men-sexual-health',
    gender: 'male',
    targetAudience: 'Sexually active men seeking a broader sexual and reproductive health screening.',
    benefits: 'Screens for selected sexually transmitted infections while providing basic reproductive and hormonal assessment.',
    includedTests: [
      'HIV 1&2 Screening Test (RVS)', 'Hepatitis B or C', 'Syphilis (VDRL)',
      'Chlamydia Screening', 'Urinalysis', 'Semen Analysis Only', 'Testosterone'
    ],
    walkInPrice: 55500,
    homeVisitPrice: 59000,
    order: 2
  },
  {
    name: 'Women Sexual Health Check',
    slug: 'women-sexual-health',
    gender: 'female',
    targetAudience: 'Sexually active women seeking convenient sexual and reproductive health screening.',
    benefits: 'Provides selected STI screening together with pregnancy testing and a basic urine assessment.',
    includedTests: [
      'HIV 1&2 Screening Test (RVS)', 'Hepatitis B or C', 'Syphilis (VDRL)',
      'Chlamydia Screening', 'HVS M/C/S & Other Surface Swabs', 'HPV'
    ],
    walkInPrice: 75000,
    homeVisitPrice: 78500,
    order: 3
  },
  {
    name: 'Pre-Marriage Test Check',
    slug: 'pre-marriage-test',
    gender: 'all',
    targetAudience: 'Couples preparing for marriage who want important baseline infectious, genetic and reproductive health information.',
    benefits: 'Provides screening for selected infectious diseases, genotype, blood group and pregnancy status before marriage.',
    includedTests: [
      'HIV 1&2 Screening Test (RVS)', 'Hepatitis B or C', 'Syphilis (VDRL)',
      'Genotype', 'Blood Grouping', 'Chlamydia Screening', 'Urinalysis'
    ],
    walkInPrice: 32500,
    homeVisitPrice: 36000,
    order: 4
  },
  {
    name: 'Women Hormone Check Gold',
    slug: 'women-hormone-gold',
    gender: 'female',
    targetAudience: 'Women seeking the broadest hormonal assessment, especially where reproductive and thyroid concerns are being evaluated.',
    benefits: 'Provides a broader reproductive and thyroid hormone profile to support clinician-guided assessment.',
    includedTests: [
      'FSH, LH, Prolactin & Progesterone (Female)',
      'FSH, LH, Prolactin, Progesterone & Estradiol (E2)',
      'Thyroid Function Test (TSH, T3, T4)'
    ],
    walkInPrice: 87000,
    homeVisitPrice: 90500,
    order: 5
  },
  {
    name: 'Women Hormone Check Bronze',
    slug: 'women-hormone-bronze',
    gender: 'female',
    targetAudience: 'Women who need a basic thyroid hormone assessment based on clinical advice.',
    benefits: 'Assesses key thyroid hormones and can support evaluation of thyroid-related symptoms.',
    includedTests: ['Thyroid Function Test (TSH, T3, T4)'],
    walkInPrice: 35000,
    homeVisitPrice: 38500,
    order: 6
  },
  {
    name: 'Back-to-School Package',
    slug: 'back-to-school',
    gender: 'all',
    targetAudience: 'Children, teenagers and young adults preparing to return to school or begin a new academic session.',
    benefits: 'Provides a basic health screening covering blood parameters, malaria, urine and stool findings, plus blood group and genotype information.',
    includedTests: [
      'Full Blood Count (FBC)', 'Malaria Parasite', 'Urinalysis',
      'Stool Microscopy', 'Blood Grouping', 'Genotype'
    ],
    walkInPrice: 25500,
    homeVisitPrice: 29000,
    order: 7
  }
]

async function seedWellnessPackages () {
  const count = await WellnessPackage.countDocuments()
  if (count > 0) {
    console.log('[seed] Wellness packages already seeded.')
    return
  }
  await WellnessPackage.insertMany(DEFAULT_WELLNESS_PACKAGES)
  console.log(`[seed] ✅ ${DEFAULT_WELLNESS_PACKAGES.length} wellness packages seeded.`)
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function runAllSeeds () {
  await seedAdmin()
  await seedSpecializations()
  await seedServices()
  await seedPlans()
  await seedLabTests()
  await seedWellnessPackages()
}

module.exports = runAllSeeds

// Standalone: node src/seeds/admin.seed.js
if (require.main === module) {
  require('dotenv').config({
    path: require('path').join(__dirname, '../../.env')
  })
  const mongoose = require('mongoose')
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => runAllSeeds())
    .then(() => mongoose.disconnect())
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
