const mongoose = require('mongoose');

// Singleton document — only one settings record ever exists
const platformSettingsSchema = new mongoose.Schema(
  {
    // Paystack toggle (keys stay in .env; this flag gates the payment option)
    paystackEnabled:      { type: Boolean, default: true },

    // Direct company bank transfer toggle
    directPaymentEnabled: { type: Boolean, default: false },
    companyBankName:      { type: String, default: '' },
    companyAccountNumber: { type: String, default: '' },
    companyAccountName:   { type: String, default: '' },
    companyBankCode:      { type: String, default: '' },
    directPaymentNote:    { type: String, default: '' },

    // Admin-controlled public content
    announcement: { type: String, default: '' },
    healthTips: [
      {
        emoji:    { type: String, default: '💡' },
        text:     { type: String, required: true },
        category: { type: String, default: 'general' },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
