const mongoose = require('mongoose');

const platformServiceSchema = new mongoose.Schema(
  {
    iconName:     { type: String, required: true }, // 'video'|'ai'|'lab'|'pharmacy'|'hospital'|'truck'
    tagLabel:     { type: String, required: true },
    title:        { type: String, required: true },
    description:  { type: String, required: true },
    steps:        [{ type: String }],
    visualLabel:  { type: String, default: '' },
    visualSub:    { type: String, default: '' },
    cta:          { type: String, default: 'Learn More' },
    ctaHref:      { type: String, default: '/signup' },
    order:        { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlatformService', platformServiceSchema);
