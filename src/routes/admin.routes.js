const router = require('express').Router();
const ctrl = require('../controllers/admin.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const { audit } = require('../middleware/audit');

// ─── Public endpoints (no auth) ────────────────────────────────
router.get('/public/content', ctrl.getPublicContent);

// ─── All routes below require admin auth ───────────────────────
router.use(protect, restrictTo('admin'));

router.get('/dashboard', ctrl.getDashboard);
router.get('/doctors', ctrl.getDoctors);
router.post('/doctors', audit('create_doctor', 'Doctor'), ctrl.createDoctor);
router.put('/doctors/:id/approve', audit('approve_doctor', 'Doctor'), ctrl.approveDoctor);
router.put('/kyc/:userId/verify', audit('manual_kyc_verify', 'User'), ctrl.manualKycVerify);
router.get('/users', ctrl.getUsers);
router.put('/users/:id/suspend', audit('suspend_user', 'User'), ctrl.suspendUser);
router.get('/appointments', ctrl.getAppointments);
router.get('/payments', ctrl.getPayments);
router.put('/payments/:id/confirm', audit('confirm_payment', 'Payment'), ctrl.confirmPayment);
router.get('/subscriptions', ctrl.getSubscriptions);
router.get('/payouts', ctrl.getPayouts);
router.put('/payouts/:id/approve', audit('approve_payout', 'DoctorEarning'), ctrl.approvePayout);
router.get('/partners', ctrl.getPartners);
router.put('/triage/questions', audit('update_triage_questions', 'Triage'), ctrl.updateTriageQuestions);

// Monitoring
router.get('/consultations', ctrl.getAllConsultations);
router.get('/consultations/live', ctrl.getLiveConsultations);
router.get('/consultations/:id/messages', ctrl.getConsultationMessages);

// Pharmacy management
router.get('/pharmacy', ctrl.getPharmacies);
router.post('/pharmacy', audit('create_pharmacy', 'PharmacyPartner'), ctrl.createPharmacy);
router.put('/pharmacy/:id/status', audit('update_pharmacy_status', 'PharmacyPartner'), ctrl.updatePharmacyStatus);

// Lab management
router.get('/labs', ctrl.getLabs);
router.post('/labs', audit('create_lab', 'LabPartner'), ctrl.createLab);
router.put('/labs/:id/status', audit('update_lab_status', 'LabPartner'), ctrl.updateLabStatus);
router.put('/labs/:id/tests', audit('update_lab_tests', 'LabPartner'), ctrl.updateLabTests);

// Diagnostics management
router.get('/diagnostics', ctrl.getDiagnosticsRequests);

// All orders & lab requests
router.get('/orders', ctrl.getAllOrders);

// Audit log
router.get('/audit', ctrl.getAuditLogs);

// Drug catalog management
router.get('/drugs', ctrl.getAllDrugs);
router.put('/pharmacy/:pharmacyId/drug/:drugId/approve', audit('approve_drug', 'PharmacyPartner'), ctrl.approveDrug);

// Pending approvals
router.get('/approvals', ctrl.getPendingApprovals);
router.put('/approvals/order/:id', audit('approve_order', 'PharmacyOrder'), ctrl.approveOrder);
router.put('/approvals/test/:id', audit('approve_test', 'DiagnosticsRequest'), ctrl.approveTestRequest);

// Platform settings
router.get('/settings', ctrl.getSettings);
router.put('/settings', audit('update_settings', 'PlatformSettings'), ctrl.updateSettings);

// Subscription plan management
router.get('/plans', ctrl.listPlans);
router.post('/plans', audit('create_plan', 'SubscriptionPlan'), ctrl.createPlan);
router.put('/plans/:id', audit('update_plan', 'SubscriptionPlan'), ctrl.updatePlan);
router.delete('/plans/:id', audit('deactivate_plan', 'SubscriptionPlan'), ctrl.deletePlan);

// Specialization management
router.get('/specializations', ctrl.listSpecializations);
router.post('/specializations', audit('create_specialization', 'Specialization'), ctrl.createSpecialization);
router.put('/specializations/:id', audit('update_specialization', 'Specialization'), ctrl.updateSpecialization);
router.delete('/specializations/:id', audit('delete_specialization', 'Specialization'), ctrl.deleteSpecialization);

// Platform service management
router.get('/services', ctrl.listServices);
router.post('/services', audit('create_service', 'PlatformService'), ctrl.createService);
router.put('/services/:id', audit('update_service', 'PlatformService'), ctrl.updateService);
router.delete('/services/:id', audit('delete_service', 'PlatformService'), ctrl.deleteService);

// Lab test catalog
router.get('/lab-tests', ctrl.listLabTests);
router.post('/lab-tests', audit('create_lab_test', 'LabTest'), ctrl.createLabTest);
router.put('/lab-tests/:id', audit('update_lab_test', 'LabTest'), ctrl.updateLabTest);
router.delete('/lab-tests/:id', audit('delete_lab_test', 'LabTest'), ctrl.deleteLabTest);

// Broadcast
router.post('/broadcast', audit('broadcast_message', 'User'), ctrl.broadcastMessage);

module.exports = router;
