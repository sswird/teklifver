const mongoose = require('mongoose');
const { names: categoryNames } = require('../config/categories');

const newRequestNumber = () => 1000000000 + Math.floor(Math.random() * 899999999);

const requestSchema = new mongoose.Schema({
  // Kullanıcıya gösterilen talep numarası
  no: {
    type: Number,
    default: newRequestNumber,
    unique: true,
    sparse: true
  },
  title: {
    type: String,
    required: [true, 'Başlık gereklidir'],
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: [true, 'Açıklama gereklidir'],
    trim: true,
    maxlength: 5000
  },
  category: {
    type: String,
    required: [true, 'Kategori gereklidir'],
    enum: categoryNames
  },
  budget: {
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 }
  },
  deadline: {
    type: Date
  },
  discoveryTime: {
    type: String,
    default: ''
  },
  city: {
    type: String,
    trim: true
  },
  // İlçe veya semt
  location: {
    type: String,
    trim: true,
    maxlength: 100
  },
  images: [{
    type: String
  }],
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'completed', 'cancelled', 'removed'],
    default: 'open'
  },
  // Yönetici kaldırınca geri alındığında dönülecek durum
  previousStatus: String,
  // Firma sayfasından teklif vermeye davet edilen firmalar
  invitedCompanies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  acceptedBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bid'
  },
  bidCount: {
    type: Number,
    default: 0
  },
  // Talep sahibinin talebi en son açtığı an: sonra gelen teklifler "yeni" görünür.
  ownerSeenAt: {
    type: Date,
    default: Date.now
  },
  viewCount: {
    type: Number,
    default: 0
  },
  isUrgent: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  questions: [{
    asker: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    askerName: String,
    question: { type: String, required: true },
    answer: String,
    createdAt: { type: Date, default: Date.now },
    answeredAt: Date
  }]
}, {
  timestamps: true
});

// Liste, kategori, il ve panel sorguları için
requestSchema.index({ status: 1, createdAt: -1 });
requestSchema.index({ status: 1, category: 1, createdAt: -1 });
requestSchema.index({ status: 1, city: 1 });
requestSchema.index({ customer: 1, createdAt: -1 });

// Bu alan eklenmeden önce oluşturulmuş taleplere numara verir.
requestSchema.statics.assignMissingNumbers = async function () {
  const missing = await this.find({ no: { $exists: false } }).select('_id');
  for (const request of missing) {
    await this.updateOne({ _id: request._id }, { $set: { no: newRequestNumber() } });
  }
};

module.exports = mongoose.model('Request', requestSchema);
