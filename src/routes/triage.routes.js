const router = require('express').Router();
const ctrl = require('../controllers/triage.controller');
const { protect } = require('../middleware/auth');

router.get('/questions', ctrl.getQuestions);

router.use(protect);

router.post('/start', ctrl.startTriage);
router.post('/answer', ctrl.submitAnswers);
router.get('/mine', ctrl.getMyTriages);
router.get('/result/:id', ctrl.getResult);

module.exports = router;
