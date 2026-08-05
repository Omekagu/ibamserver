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
const DEFAULT_LAB_TESTS = [
  {
    name: 'Full Blood Count (FBC)',
    category: 'Haematology',
    walkInPrice: 3500,
    homeVisitPrice: 5500,
    estimatedPrice: 3500,
    turnaroundHours: 24,
    order: 0
  },
  {
    name: 'Malaria Parasite Test',
    category: 'Microbiology',
    walkInPrice: 2000,
    homeVisitPrice: 3500,
    estimatedPrice: 2000,
    turnaroundHours: 12,
    order: 1
  },
  {
    name: 'Blood Sugar (Fasting Glucose)',
    category: 'Biochemistry',
    walkInPrice: 1500,
    homeVisitPrice: 3000,
    estimatedPrice: 1500,
    turnaroundHours: 6,
    order: 2
  },
  {
    name: 'Hepatitis B Surface Antigen',
    category: 'Serology',
    walkInPrice: 3000,
    homeVisitPrice: 5000,
    estimatedPrice: 3000,
    turnaroundHours: 24,
    order: 3
  },
  {
    name: 'HIV Screening',
    category: 'Serology',
    walkInPrice: 3000,
    homeVisitPrice: 5000,
    estimatedPrice: 3000,
    turnaroundHours: 24,
    order: 4
  },
  {
    name: 'Urine Analysis',
    category: 'Microbiology',
    walkInPrice: 1500,
    homeVisitPrice: 3000,
    estimatedPrice: 1500,
    turnaroundHours: 12,
    order: 5
  },
  {
    name: 'Widal Test',
    category: 'Serology',
    walkInPrice: 2000,
    homeVisitPrice: 3500,
    estimatedPrice: 2000,
    turnaroundHours: 24,
    order: 6
  },
  {
    name: 'Electrolytes, Urea & Creatinine',
    category: 'Biochemistry',
    walkInPrice: 5000,
    homeVisitPrice: 7500,
    estimatedPrice: 5000,
    turnaroundHours: 24,
    order: 7
  },
  {
    name: 'Liver Function Tests (LFT)',
    category: 'Biochemistry',
    walkInPrice: 6000,
    homeVisitPrice: 9000,
    estimatedPrice: 6000,
    turnaroundHours: 24,
    order: 8
  },
  {
    name: 'Lipid Profile',
    category: 'Biochemistry',
    walkInPrice: 5500,
    homeVisitPrice: 8000,
    estimatedPrice: 5500,
    turnaroundHours: 24,
    order: 9
  },
  {
    name: 'Kidney Function Test (KFT)',
    category: 'Biochemistry',
    walkInPrice: 5000,
    homeVisitPrice: 7500,
    estimatedPrice: 5000,
    turnaroundHours: 24,
    order: 10
  },
  {
    name: 'Thyroid Function (TSH)',
    category: 'Endocrinology',
    walkInPrice: 6500,
    homeVisitPrice: 9500,
    estimatedPrice: 6500,
    turnaroundHours: 48,
    order: 11
  },
  {
    name: 'Hepatitis C Antibody',
    category: 'Serology',
    walkInPrice: 3500,
    homeVisitPrice: 5500,
    estimatedPrice: 3500,
    turnaroundHours: 24,
    order: 12
  },
  {
    name: 'Blood Group & Genotype',
    category: 'Haematology',
    walkInPrice: 2500,
    homeVisitPrice: 4500,
    estimatedPrice: 2500,
    turnaroundHours: 6,
    order: 13
  },
  {
    name: 'Chest X-Ray',
    category: 'Radiology',
    walkInPrice: 8000,
    homeVisitPrice: null,
    estimatedPrice: 8000,
    turnaroundHours: 4,
    order: 14
  },
  {
    name: 'ECG',
    category: 'Cardiology',
    walkInPrice: 5000,
    homeVisitPrice: null,
    estimatedPrice: 5000,
    turnaroundHours: 2,
    order: 15
  },
  {
    name: 'Pregnancy Test (hCG)',
    category: 'Serology',
    walkInPrice: 1500,
    homeVisitPrice: 3000,
    estimatedPrice: 1500,
    turnaroundHours: 2,
    order: 16
  },
  {
    name: 'Prostate Specific Antigen (PSA)',
    category: 'Oncology',
    walkInPrice: 8000,
    homeVisitPrice: 11000,
    estimatedPrice: 8000,
    turnaroundHours: 48,
    order: 17
  },
  {
    name: 'Rheumatoid Factor',
    category: 'Immunology',
    walkInPrice: 4000,
    homeVisitPrice: 6500,
    estimatedPrice: 4000,
    turnaroundHours: 24,
    order: 18
  },
  {
    name: 'Vitamin D (25-OH)',
    category: 'Endocrinology',
    walkInPrice: 12000,
    homeVisitPrice: 16000,
    estimatedPrice: 12000,
    turnaroundHours: 48,
    order: 19
  }
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

// ─── Entry point ──────────────────────────────────────────────────────────────
async function runAllSeeds () {
  await seedAdmin()
  await seedSpecializations()
  await seedServices()
  await seedPlans()
  await seedLabTests()
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
