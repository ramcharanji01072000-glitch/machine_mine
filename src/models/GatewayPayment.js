const mongoose = require('mongoose');
const { autoIncrement } = require('./Counter');

// A wallet recharge paid through the YouPI gateway.
// Lifecycle: created -> active -> observed | manual_review | reconciled | failed | expired | cancelled
// The wallet is credited at most once (creditedAt / creditTxnId), by a verified webhook or an admin.
const STATUSES = ['created', 'active', 'observed', 'manual_review', 'reconciled', 'failed', 'expired', 'cancelled', 'error'];

const schema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, index: true },
    orderId: { type: String, required: true, unique: true }, // our id sent to YouPI
    amountPaise: { type: Number, required: true },
    gatewayPaymentId: { type: String, index: true, sparse: true },
    checkoutUrl: String,
    status: { type: String, enum: STATUSES, default: 'created', index: true },
    settlementState: String,
    verificationLevel: Number,
    creditedAt: Date,
    creditTxnId: Number,
    creditedBy: String, // 'webhook' | 'admin:<username>'
    error: String,
    events: [
      {
        _id: false,
        event: String,
        deliveryId: String,
        settlementState: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true, id: false }
);
autoIncrement(schema, 'gatewayPayment');

const GatewayPayment = mongoose.model('GatewayPayment', schema);
GatewayPayment.STATUSES = STATUSES;
module.exports = GatewayPayment;
