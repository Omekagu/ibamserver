const { randomUUID } = require('crypto')
const PharmacyPartner = require('../models/PharmacyPartner')
const PharmacyOrder = require('../models/PharmacyOrder')
const Payment = require('../models/Payment')
const Prescription = require('../models/Prescription')
const User = require('../models/User')
const { uploadBuffer } = require('../services/cloudinary.service')
const {
  createNotification,
  notifyAdmins
} = require('../services/notification.service')
const {
  sendAdminAlertEmail,
  sendPharmacyOrderConfirmedEmail
} = require('../services/email.service')
const { sendSuccess } = require('../utils/response')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

exports.onboard = asyncHandler(async (req, res, next) => {
  const {
    name,
    address,
    phone,
    email,
    password,
    coverageAreas,
    licenseNumber,
    operatingHours
  } = req.body
  if (!name || !address || !phone || !email || !password) {
    return next(
      new AppError(
        'Name, address, phone, email and password are required.',
        400
      )
    )
  }
  const existing = await User.findOne({ email: email.toLowerCase().trim() })
  if (existing)
    return next(new AppError('An account with this email already exists.', 409))

  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    password,
    role: 'pharmacy_partner',
    isVerified: false
  })

  const partner = await PharmacyPartner.create({
    name,
    address,
    phone,
    email,
    licenseNumber,
    coverageAreas: coverageAreas || [],
    operatingHours: operatingHours || {},
    status: 'pending',
    user: user._id
  })

  sendAdminAlertEmail({
    subject: 'New pharmacy partner application',
    headline: 'New Pharmacy Application',
    body: `${name} (${email}) has applied to join as a pharmacy partner and is awaiting approval.`,
    ctaLabel: 'Review Partners',
    ctaUrl: `${
      process.env.CLIENT_URL || 'http://10.0.1.44:3000'
    }/admin/partners`
  }).catch(err =>
    console.error('[Email] Admin pharmacy alert failed:', err.message)
  )

  notifyAdmins({
    type: 'partner_onboarded',
    title: 'New Pharmacy Application',
    message: `${name} applied to join as a pharmacy partner and is awaiting review.`,
    metadata: { partnerId: partner._id, email }
  }).catch(() => {})

  sendSuccess(
    res,
    201,
    'Application submitted. You will be notified once approved.',
    { partner }
  )
})

exports.listPartners = asyncHandler(async (req, res) => {
  const partners = await PharmacyPartner.find({ status: 'active' }).select(
    'name address phone email logo coverageAreas operatingHours coordinates drugsOffered status'
  )
  // Include drug count but not full drug list in the listing
  const list = partners.map(p => ({
    _id: p._id,
    name: p.name,
    address: p.address,
    phone: p.phone,
    email: p.email,
    logo: p.logo,
    coverageAreas: p.coverageAreas,
    operatingHours: p.operatingHours,
    coordinates: p.coordinates,
    drugCount: (p.drugsOffered || []).filter(d => d.inStock).length
  }))
  sendSuccess(res, 200, 'Pharmacy partners retrieved.', { partners: list })
})

exports.searchDrugs = asyncHandler(async (req, res) => {
  const { q = '' } = req.query
  if (!q.trim())
    return sendSuccess(res, 200, 'Drugs retrieved.', { results: [] })
  const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const partners = await PharmacyPartner.find({
    status: 'active',
    drugsOffered: { $elemMatch: { name: regex, inStock: true } }
  }).select('name address phone logo coverageAreas operatingHours drugsOffered')

  const results = []
  for (const p of partners) {
    const matched = p.drugsOffered.filter(d => regex.test(d.name) && d.inStock)
    for (const d of matched) {
      results.push({
        drug: {
          _id: d._id,
          name: d.name,
          price: d.price,
          unit: d.unit,
          requiresPrescription: d.requiresPrescription
        },
        pharmacy: {
          _id: p._id,
          name: p.name,
          address: p.address,
          logo: p.logo,
          coverageAreas: p.coverageAreas,
          operatingHours: p.operatingHours
        }
      })
    }
  }
  sendSuccess(res, 200, 'Drugs retrieved.', { results })
})

exports.uploadPharmacyLogo = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('No image file provided.', 400))
  const partner = await PharmacyPartner.findOne({ user: req.user._id })
  if (!partner)
    return next(new AppError('Pharmacy partner record not found.', 404))
  const uploaded = await uploadBuffer(
    req.file.buffer,
    'pharmacy_logos',
    'image'
  )
  partner.logo = uploaded.secure_url
  await partner.save()
  sendSuccess(res, 200, 'Logo updated.', { logo: partner.logo })
})

// â”€â”€â”€ Drug Catalog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

exports.getOwnCatalog = asyncHandler(async (req, res, next) => {
  const partner = await PharmacyPartner.findOne({ user: req.user._id })
  if (!partner)
    return next(new AppError('Pharmacy partner record not found.', 404))
  sendSuccess(res, 200, 'Catalog retrieved.', {
    drugs: partner.drugsOffered,
    partner
  })
})

exports.updateCatalog = asyncHandler(async (req, res, next) => {
  const { drugs } = req.body
  if (!Array.isArray(drugs))
    return next(new AppError('drugs must be an array.', 400))

  const partner = await PharmacyPartner.findOne({ user: req.user._id })
  if (!partner)
    return next(new AppError('Pharmacy partner record not found.', 404))

  const formatted = drugs.map(d => ({
    _id: d._id || undefined,
    name: d.name,
    price: Number(d.price),
    unit: d.unit || 'pack',
    requiresPrescription: Boolean(d.requiresPrescription),
    inStock: d.inStock !== false,
    adminApproved: true
  }))

  partner.drugsOffered = formatted
  await partner.save()
  sendSuccess(res, 200, 'Drug catalog updated.', {
    drugs: partner.drugsOffered
  })
})

exports.getPublicCatalog = asyncHandler(async (req, res, next) => {
  const partner = await PharmacyPartner.findById(req.params.id).select(
    'name address phone drugsOffered status'
  )
  if (!partner || partner.status !== 'active')
    return next(new AppError('Pharmacy not found.', 404))
  const approvedDrugs = partner.drugsOffered.filter(d => d.inStock)
  sendSuccess(res, 200, 'Catalog retrieved.', { partner, drugs: approvedDrugs })
})

// â”€â”€â”€ Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

exports.placeOrder = asyncHandler(async (req, res, next) => {
  const { prescriptionId, pharmacyId, fulfillmentType, deliveryAddress } =
    req.body
  if (fulfillmentType === 'delivery' && !deliveryAddress) {
    return next(
      new AppError('Delivery address required for delivery orders.', 400)
    )
  }

  const prescription = await Prescription.findById(prescriptionId)
  if (!prescription) return next(new AppError('Prescription not found.', 404))
  if (prescription.patient.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorised.', 403))
  }

  const pharmacy = await PharmacyPartner.findById(pharmacyId)
  if (!pharmacy || pharmacy.status !== 'active') {
    return next(new AppError('Pharmacy not found or inactive.', 404))
  }

  // Match prescription medications against pharmacy catalog to compute total
  let totalAmount = 0
  const matchedItems = []
  for (const med of prescription.medications ?? []) {
    const medName = (med.name || '').toLowerCase().trim()
    const catalogDrug = (pharmacy.drugsOffered || []).find(d => {
      if (!d.inStock) return false
      const cn = d.name.toLowerCase()
      return cn.includes(medName) || medName.includes(cn)
    })
    if (catalogDrug) {
      totalAmount += catalogDrug.price
      matchedItems.push({
        name: catalogDrug.name,
        price: catalogDrug.price,
        qty: 1
      })
    }
  }

  let pickupLocation
  if (fulfillmentType === 'pickup') {
    try {
      pickupLocation = req.body.pickupLocation
        ? JSON.parse(req.body.pickupLocation)
        : undefined
    } catch {
      /* ignore */
    }
  }

  const order = await PharmacyOrder.create({
    orderType: 'prescription',
    prescription: prescriptionId,
    patient: req.user._id,
    pharmacy: pharmacyId,
    fulfillmentType,
    deliveryAddress,
    pickupLocation,
    items: matchedItems,
    totalAmount
  })

  const prescriptionItems = (prescription.medications || []).map(m => ({
    name: m.name || String(m)
  }))

  // Patient notified only for free orders here; paid orders get notified in payments verify handler
  if (totalAmount === 0) {
    createNotification({
      userId: req.user._id,
      type: 'pharmacy_order_placed',
      title: 'Pharmacy Order Placed',
      message:
        'Your prescription order has been submitted and is awaiting processing.',
      metadata: { orderId: order._id },
      emailData: { pharmacyName: pharmacy.name, items: prescriptionItems }
    }).catch(err =>
      console.error('[Notification] Pharmacy order placed:', err.message)
    )

    sendPharmacyOrderConfirmedEmail({
      email: req.user.email,
      name: req.user.name,
      pharmacyName: pharmacy.name,
      items: prescriptionItems
    }).catch(() => {})
  }

  sendSuccess(res, 201, 'Order placed.', { order, totalAmount })
})

exports.placeDirectOrder = asyncHandler(async (req, res, next) => {
  const { pharmacyId, fulfillmentType, deliveryAddress, notes } = req.body
  // items may arrive as a JSON string (FormData) or as an array (JSON body)
  let items
  try {
    items =
      typeof req.body.items === 'string'
        ? JSON.parse(req.body.items)
        : req.body.items
  } catch {
    items = []
  }
  if (!pharmacyId) return next(new AppError('pharmacyId is required.', 400))
  if (!Array.isArray(items) || items.length === 0)
    return next(new AppError('items array is required.', 400))
  if (!fulfillmentType)
    return next(new AppError('fulfillmentType is required.', 400))
  if (fulfillmentType === 'delivery' && !deliveryAddress) {
    return next(
      new AppError('Delivery address required for delivery orders.', 400)
    )
  }

  const pharmacy = await PharmacyPartner.findById(pharmacyId)
  if (!pharmacy || pharmacy.status !== 'active')
    return next(new AppError('Pharmacy not found or inactive.', 404))

  let totalAmount = 0
  let requiresApproval = false
  const orderItems = []

  for (const item of items) {
    const catalogDrug = pharmacy.drugsOffered.find(
      d => String(d._id) === String(item.drugId)
    )
    if (!catalogDrug)
      return next(
        new AppError(`Drug not found in pharmacy catalog: ${item.name}`, 400)
      )
    if (!catalogDrug.inStock)
      return next(
        new AppError(`${catalogDrug.name} is currently out of stock.`, 400)
      )
    const qty = Math.max(1, parseInt(item.qty) || 1)
    totalAmount += catalogDrug.price * qty
    if (catalogDrug.requiresPrescription) requiresApproval = true
    orderItems.push({ name: catalogDrug.name, price: catalogDrug.price, qty })
  }

  let externalPrescriptionUrl
  if (req.file) {
    const uploaded = await uploadBuffer(
      req.file.buffer,
      'prescriptions',
      'auto'
    )
    externalPrescriptionUrl = uploaded.secure_url
  }

  let pickupLocation
  if (fulfillmentType === 'pickup') {
    try {
      pickupLocation = req.body.pickupLocation
        ? JSON.parse(req.body.pickupLocation)
        : undefined
    } catch {
      /* ignore */
    }
  }

  const order = await PharmacyOrder.create({
    orderType: 'direct',
    items: orderItems,
    patient: req.user._id,
    pharmacy: pharmacyId,
    fulfillmentType,
    deliveryAddress,
    totalAmount,
    requiresApproval,
    adminApprovalStatus: requiresApproval ? 'pending' : 'na',
    externalPrescriptionUrl,
    notes,
    pickupLocation
  })

  // Notify pharmacy partner only for zero-price orders; priced orders notify after Paystack payment confirmed
  if (pharmacy.user && totalAmount === 0) {
    createNotification({
      userId: pharmacy.user,
      type: 'pharmacy_order_placed',
      title: 'New Order Received',
      message: `A new order has been placed with you${
        requiresApproval
          ? ' (awaiting admin approval for prescription items)'
          : ''
      }.`,
      metadata: { orderId: order._id }
    }).catch(err =>
      console.error(
        '[Notification] Pharmacy partner direct order:',
        err.message
      )
    )
  }

  // Only alert admin immediately for prescription orders needing approval; normal orders notified after payment
  if (requiresApproval) {
    sendAdminAlertEmail({
      subject: `Pharmacy order awaiting approval  ${req.user.name}`,
      headline: 'Pharmacy Order Pending Approval',
      body: `${req.user.name || 'A patient'} placed an order from ${
        pharmacy.name
      } containing prescription drugs that require admin approval.`,
      ctaLabel: 'Review Order',
      ctaUrl: `${
        process.env.CLIENT_URL || 'https://ibamhealth.com'
      }/admin/orders`
    }).catch(err =>
      console.error('[Email] Admin pharmacy order alert:', err.message)
    )
    notifyAdmins({
      type: 'pharmacy_order_placed',
      title: 'Order Awaiting Approval',
      message: `${req.user.name || 'A patient'} ordered from ${
        pharmacy.name
      }  contains prescription drugs, requires approval.`,
      metadata: {
        orderId: order._id,
        patientId: req.user._id,
        requiresApproval
      }
    }).catch(() => {})
  }

  // Only notify patient immediately for free orders or approval-needed orders;
  // paid orders are notified after payment is confirmed in payments verify handler
  if (totalAmount === 0 || requiresApproval) {
    createNotification({
      userId: req.user._id,
      type: 'pharmacy_order_placed',
      title: 'Pharmacy Order Placed',
      message: requiresApproval
        ? 'Your order requires admin approval because it contains prescription drugs.'
        : `Your order from ${pharmacy.name} has been placed successfully.`,
      metadata: { orderId: order._id },
      emailData: { pharmacyName: pharmacy.name, items: orderItems }
    }).catch(err =>
      console.error('[Notification] Direct order placed:', err.message)
    )

    if (totalAmount === 0) {
      sendPharmacyOrderConfirmedEmail({
        email: req.user.email,
        name: req.user.name,
        pharmacyName: pharmacy.name,
        items: orderItems
      }).catch(() => {})
    }
  }

  sendSuccess(res, 201, 'Order placed.', { order, requiresApproval })
})

// â”€â”€ Multi-pharmacy batch checkout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Creates one PharmacyOrder per pharmacy; the client uses the returned orderIds
// and batchTotal to initiate a single Paystack payment of type 'pharmacy_batch'.
exports.placeBatchOrders = asyncHandler(async (req, res, next) => {
  const { groups, fulfillmentType, deliveryAddress, notes } = req.body
  // groups: [{ pharmacyId, items: [{ drugId, qty }] }]
  if (!Array.isArray(groups) || groups.length === 0) {
    return next(new AppError('groups array is required.', 400))
  }
  if (!fulfillmentType)
    return next(new AppError('fulfillmentType is required.', 400))
  if (fulfillmentType === 'delivery' && !deliveryAddress) {
    return next(new AppError('deliveryAddress required for delivery.', 400))
  }

  const createdOrders = []
  let batchTotal = 0
  let requiresApproval = false

  for (const group of groups) {
    const { pharmacyId, items } = group
    if (!pharmacyId || !Array.isArray(items) || items.length === 0) continue

    const pharmacy = await PharmacyPartner.findById(pharmacyId)
    if (!pharmacy || pharmacy.status !== 'active') {
      return next(
        new AppError(`Pharmacy ${pharmacyId} not found or inactive.`, 404)
      )
    }

    let groupTotal = 0
    let groupNeedsApproval = false
    const orderItems = []

    for (const item of items) {
      const drug = pharmacy.drugsOffered.find(
        d => String(d._id) === String(item.drugId)
      )
      if (!drug)
        return next(new AppError(`Drug not in ${pharmacy.name} catalog.`, 400))
      if (!drug.inStock)
        return next(
          new AppError(`${drug.name} is out of stock at ${pharmacy.name}.`, 400)
        )
      const qty = Math.max(1, parseInt(item.qty) || 1)
      groupTotal += drug.price * qty
      if (drug.requiresPrescription) groupNeedsApproval = true
      orderItems.push({ name: drug.name, price: drug.price, qty })
    }

    if (groupNeedsApproval) requiresApproval = true

    const order = await PharmacyOrder.create({
      orderType: 'direct',
      items: orderItems,
      patient: req.user._id,
      pharmacy: pharmacyId,
      fulfillmentType,
      deliveryAddress,
      totalAmount: groupTotal,
      requiresApproval: groupNeedsApproval,
      adminApprovalStatus: groupNeedsApproval ? 'pending' : 'na',
      notes
    })

    batchTotal += groupTotal
    createdOrders.push({
      orderId: order._id,
      pharmacyId,
      pharmacyName: pharmacy.name,
      total: groupTotal
    })

    if (groupNeedsApproval) {
      notifyAdmins({
        type: 'pharmacy_order_placed',
        title: 'Batch Order  Approval Needed',
        message: `${req.user.name} ordered from ${pharmacy.name} with prescription items requiring approval.`,
        metadata: { orderId: order._id, patientId: req.user._id }
      }).catch(() => {})
    }
  }

  if (createdOrders.length === 0) {
    return next(new AppError('No valid order groups provided.', 400))
  }

  sendSuccess(res, 201, 'Batch orders created.', {
    orders: createdOrders,
    orderIds: createdOrders.map(o => o.orderId),
    batchTotal,
    requiresApproval
  })
})

exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status, totalAmount } = req.body
  const order = await PharmacyOrder.findById(req.params.id).populate('pharmacy')
  if (!order) return next(new AppError('Order not found.', 404))

  const isPharmacy = order.pharmacy.user?.toString() === req.user._id.toString()
  if (!isPharmacy && req.user.role !== 'admin') {
    return next(new AppError('Not authorised.', 403))
  }

  if (status) order.status = status
  // Only allow amount edit if no confirmed payment exists
  if (totalAmount !== undefined && totalAmount >= 0 && !order.paymentRef)
    order.totalAmount = totalAmount

  // When a pharmacy partner confirms a walk-in/pickup order as processing,
  // record the cash payment so the platform has an audit trail
  if (
    status === 'processing' &&
    order.fulfillmentType === 'pickup' &&
    !order.paymentRef &&
    order.totalAmount > 0
  ) {
    const reference = `ibam_wic_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const payment = await Payment.create({
      user: order.patient,
      amount: order.totalAmount * 100, // store in kobo
      reference,
      type: 'pharmacy',
      method: 'walk_in_cash',
      serviceRef: order._id,
      status: 'success'
    })
    order.paymentRef = payment._id
  }

  await order.save()

  await createNotification({
    userId: order.patient,
    type: 'pharmacy_order_update',
    title: 'Pharmacy Order Update',
    message: `Your pharmacy order status has changed to: ${status}.`,
    metadata: { orderId: order._id },
    emailData: {
      status,
      pharmacyName: order.pharmacy?.name || 'Pharmacy',
      items: order.items || []
    }
  })

  sendSuccess(res, 200, 'Order status updated.', { order })
})

exports.cancelMyOrder = asyncHandler(async (req, res, next) => {
  const order = await PharmacyOrder.findOne({
    _id: req.params.id,
    patient: req.user._id
  })
  if (!order) return next(new AppError('Order not found.', 404))
  if (order.paymentRef)
    return next(new AppError('Cannot cancel a paid order.', 400))
  if (order.status === 'cancelled')
    return sendSuccess(res, 200, 'Already cancelled.', {})
  order.status = 'cancelled'
  await order.save()
  sendSuccess(res, 200, 'Order cancelled.', {})
})

exports.getMyOrders = asyncHandler(async (req, res) => {
  // Only show orders that are paid or free  abandoned pre-payment orders are excluded
  const orders = await PharmacyOrder.find({
    patient: req.user._id,
    $or: [{ paymentRef: { $exists: true } }, { totalAmount: 0 }]
  })
    .populate('pharmacy', 'name address phone')
    .populate('prescription', 'medications diagnosis')
    .sort({ createdAt: -1 })
  sendSuccess(res, 200, 'Orders retrieved.', { orders })
})

exports.getPharmacyProfile = asyncHandler(async (req, res, next) => {
  const partner = await PharmacyPartner.findOne({ user: req.user._id })
  if (!partner)
    return next(new AppError('Pharmacy partner record not found.', 404))
  sendSuccess(res, 200, 'Profile retrieved.', { partner })
})

exports.updatePharmacyProfile = asyncHandler(async (req, res, next) => {
  const { name, address, phone, coverageAreas, operatingHours, logo } = req.body
  // bankAccount is intentionally excluded  use POST /api/kyc/verify-bank instead
  const update = {
    ...(name && { name }),
    ...(address && { address }),
    ...(phone && { phone }),
    ...(coverageAreas && { coverageAreas }),
    ...(operatingHours && { operatingHours }),
    ...(logo !== undefined && { logo })
  }
  const partner = await PharmacyPartner.findOneAndUpdate(
    { user: req.user._id },
    update,
    { returnDocument: 'after', runValidators: true }
  )
  if (!partner)
    return next(new AppError('Pharmacy partner record not found.', 404))
  sendSuccess(res, 200, 'Profile updated.', { partner })
})

exports.getPartnerOrders = asyncHandler(async (req, res) => {
  const partner = await PharmacyPartner.findOne({ user: req.user._id })
  if (!partner) return sendSuccess(res, 200, 'No orders.', { orders: [] })
  // Only expose orders that have been paid (paymentRef set) or are free direct orders (totalAmount 0).
  // Unpaid pending orders are hidden from the pharmacy partner until payment is confirmed.
  const orders = await PharmacyOrder.find({
    pharmacy: partner._id,
    $or: [
      { paymentRef: { $exists: true } },
      { totalAmount: 0, orderType: 'direct' }
    ]
  })
    .populate('patient', 'name phone _id')
    .populate('prescription')
    .populate({ path: 'paymentRef', select: 'status amount reference method' })
    .sort({ createdAt: -1 })
  sendSuccess(res, 200, 'Partner orders retrieved.', { orders })
})

exports.getPharmacyEarnings = asyncHandler(async (req, res) => {
  const PartnerEarning = require('../models/PartnerEarning')
  const PayoutRequest = require('../models/PayoutRequest')

  const earnings = await PartnerEarning.find({
    partner: req.user._id,
    partnerType: 'pharmacy'
  }).sort({ createdAt: -1 })

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
    999
  )

  // Last 6 months breakdown for mini chart
  const monthly = []
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(
      now.getFullYear(),
      now.getMonth() - i + 1,
      0,
      23,
      59,
      59,
      999
    )
    const label = start.toLocaleDateString('en-NG', {
      month: 'short',
      year: '2-digit'
    })
    const bucket = earnings.filter(e => {
      const t = new Date(e.createdAt)
      return t >= start && t <= end
    })
    monthly.push({
      label,
      net: Math.round(bucket.reduce((a, e) => a + e.netAmount, 0) * 100) / 100,
      gross:
        Math.round(bucket.reduce((a, e) => a + e.grossAmount, 0) * 100) / 100,
      count: bucket.length
    })
  }

  const totals = earnings.reduce(
    (acc, e) => {
      acc.gross += e.grossAmount
      acc.net += e.netAmount
      if (e.payoutStatus === 'pending') acc.pending += e.netAmount
      if (e.payoutStatus === 'requested') acc.requested += e.netAmount
      if (e.payoutStatus === 'paid') acc.paid += e.netAmount
      return acc
    },
    { gross: 0, net: 0, pending: 0, requested: 0, paid: 0 }
  )

  const thisMonth = earnings
    .filter(e => new Date(e.createdAt) >= startOfMonth)
    .reduce((a, e) => a + e.netAmount, 0)

  const lastMonth = earnings
    .filter(e => {
      const t = new Date(e.createdAt)
      return t >= startOfLastMonth && t <= endOfLastMonth
    })
    .reduce((a, e) => a + e.netAmount, 0)

  // Payout request history for this partner
  const payoutHistory = await PayoutRequest.find({
    partner: req.user._id,
    partnerType: 'pharmacy'
  })
    .sort({ requestedAt: -1 })
    .limit(10)
    .lean()

  sendSuccess(res, 200, 'Earnings retrieved.', {
    earnings,
    totals,
    monthly,
    thisMonth: Math.round(thisMonth * 100) / 100,
    lastMonth: Math.round(lastMonth * 100) / 100,
    payoutHistory
  })
})

exports.requestPharmacyPayout = asyncHandler(async (req, res, next) => {
  const PartnerEarning = require('../models/PartnerEarning')
  const PayoutRequest = require('../models/PayoutRequest')

  const pending = await PartnerEarning.find({
    partner: req.user._id,
    partnerType: 'pharmacy',
    payoutStatus: 'pending'
  })
  if (!pending.length)
    return next(new AppError('No pending earnings to pay out.', 400))

  const pharmacy = await PharmacyPartner.findOne({ user: req.user._id }).lean()
  const bankAccount = pharmacy?.bankAccount || {}
  const ids = pending.map(e => e._id)
  const totalGross =
    Math.round(pending.reduce((s, e) => s + e.grossAmount, 0) * 100) / 100
  const totalNet =
    Math.round(pending.reduce((s, e) => s + e.netAmount, 0) * 100) / 100

  // Merge into existing open request for this partner, or create a new one
  let request = await PayoutRequest.findOne({
    partner: req.user._id,
    status: 'requested'
  })
  if (request) {
    request.earningIds.push(...ids)
    request.totalGross =
      Math.round((request.totalGross + totalGross) * 100) / 100
    request.totalNet = Math.round((request.totalNet + totalNet) * 100) / 100
    if (bankAccount.accountNumber) request.bankAccount = bankAccount
    await request.save()
  } else {
    request = await PayoutRequest.create({
      partner: req.user._id,
      partnerType: 'pharmacy',
      partnerName: pharmacy?.name || req.user.name,
      earningIds: ids,
      totalGross,
      totalNet,
      bankAccount,
      requestedAt: new Date()
    })
  }

  await PartnerEarning.updateMany(
    { _id: { $in: ids } },
    { payoutStatus: 'requested', payoutRequestedAt: new Date() }
  )

  notifyAdmins({
    type: 'payout_requested',
    title: 'Pharmacy Payout Request',
    message: `${
      req.user.name
    } (pharmacy) requested a payout of ₦${totalNet.toLocaleString('en-NG')}.`,
    metadata: {
      partnerId: req.user._id,
      amount: totalNet,
      partnerType: 'pharmacy'
    }
  }).catch(() => {})

  sendSuccess(res, 200, 'Payout requested.', {
    totalRequested: totalNet,
    count: pending.length
  })
})
