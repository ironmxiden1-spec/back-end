const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullname: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    default: ""
  },
  balance: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  googleId: {
    type: String,
    default: ""
  },
  resetPasswordTokenHash: {
    type: String,
    default: ""
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model("User", userSchema);