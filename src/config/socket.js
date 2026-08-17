const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Consultation = require('../models/Consultation');
const Appointment   = require('../models/Appointment');
const DoctorEarning = require('../models/DoctorEarning');

const PLATFORM_CUT = Number(process.env.PLATFORM_CUT_PERCENT) || 20;

// consultationId → setTimeout handle — lets us cancel if the doctor reconnects quickly
const disconnectTimers = new Map();

async function finaliseConsultation (consultationId, doctorUserId) {
  try {
    const consultation = await Consultation.findOne({
      _id: consultationId,
      status: 'active',
    }).populate('appointment');

    if (!consultation) return;
    if (consultation.appointment?.doctor?.toString() !== String(doctorUserId)) return;

    const durationMs = Date.now() - consultation.startedAt.getTime();
    consultation.status    = 'ended';
    consultation.endedAt   = new Date();
    consultation.duration  = Math.ceil(durationMs / 60000);
    consultation.timedOut  = true;
    await consultation.save();

    const appt = consultation.appointment;
    appt.status = 'completed';
    await appt.save();

    if (appt.consultationFee > 0) {
      const already = await DoctorEarning.findOne({ consultation: consultation._id });
      if (!already) {
        const cut = (appt.consultationFee * PLATFORM_CUT) / 100;
        await DoctorEarning.create({
          doctor: appt.doctor,
          consultation: consultation._id,
          grossAmount: appt.consultationFee,
          platformCut: cut,
          netAmount: appt.consultationFee - cut,
        });
      }
    }
  } catch (err) {
    console.error('[Socket] finaliseConsultation error:', err.message);
  }
}

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.role = decoded.role;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    socket.on('join_consultation', (consultationId) => {
      socket.join(`consultation:${consultationId}`);
      if (socket.role === 'doctor') {
        socket.consultationId = consultationId;
        // Cancel any pending finalise timer from a previous disconnect
        if (disconnectTimers.has(consultationId)) {
          clearTimeout(disconnectTimers.get(consultationId));
          disconnectTimers.delete(consultationId);
        }
      }
    });

    socket.on('leave_consultation', (consultationId) => {
      socket.leave(`consultation:${consultationId}`);
    });

    socket.on('send_message', (data) => {
      io.to(`consultation:${data.consultationId}`).emit('new_message', data);
    });

    socket.on('typing', (data) => {
      socket.to(`consultation:${data.consultationId}`).emit('user_typing', {
        userId: socket.userId,
        isTyping: data.isTyping,
      });
    });

    socket.on('disconnect', () => {
      socket.leave(`user:${socket.userId}`);

      // If a doctor disconnects mid-consultation, wait 15 s for reconnect before finalising
      if (socket.role === 'doctor' && socket.consultationId) {
        const cid    = socket.consultationId;
        const userId = socket.userId;
        const timer  = setTimeout(() => {
          disconnectTimers.delete(cid);
          finaliseConsultation(cid, userId);
        }, 15_000);
        disconnectTimers.set(cid, timer);
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialised');
  return io;
};

module.exports = { initSocket, getIO };
