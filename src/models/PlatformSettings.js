const mongoose = require('mongoose');

// Singleton document — only one settings record ever exists
const platformSettingsSchema = new mongoose.Schema(
  {
    // Active payment provider — 'paystack' | 'monnify'
    paymentProvider: { type: String, enum: ['paystack', 'monnify'], default: 'paystack' },

    // Paystack toggle and API keys (keys stored in DB; env fallback)
    paystackEnabled:   { type: Boolean, default: true },
    paystackSecretKey: { type: String, default: '' },
    paystackPublicKey: { type: String, default: '' },

    // Monnify credentials
    monnifyEnabled:              { type: Boolean, default: false },
    monnifyApiKey:               { type: String, default: '' },
    monnifySecretKey:            { type: String, default: '' },
    monnifyContractCode:         { type: String, default: '' },
    monnifyBaseUrl:              { type: String, default: 'https://sandbox.monnify.com' },
    monnifySourceAccountNumber:  { type: String, default: '' },

    // OTP for unlocking payment key changes
    settingsOtpHash:   { type: String, select: false },
    settingsOtpExpiry: { type: Date },

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
