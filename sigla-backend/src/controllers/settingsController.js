const { UserSetting } = require("../models/index.js");

// ── GET /api/users/settings ───────────────────────────────────
const getMySettings = async (req, res) => {
  try {
    const setting = await UserSetting.findOne({
      where: { user_id: req.user.id },
    });

    if (!setting) {
      return res.status(404).json({ message: "Settings not found" });
    }

    return res.status(200).json({ settings: setting });
  } catch (err) {
    console.error("Get settings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PATCH /api/users/settings ─────────────────────────────────
const updateMySettings = async (req, res) => {
  try {
    const { volume, voice_type, text_size, dark_mode } = req.body;

    const updates = {};

    if (volume !== undefined) {
      const v = parseInt(volume);
      if (isNaN(v) || v < 0 || v > 100) {
        return res.status(400).json({ message: "volume must be 0–100" });
      }
      updates.volume = v;
    }

    if (voice_type !== undefined) {
      if (!["male", "female"].includes(voice_type)) {
        return res.status(400).json({ message: "voice_type must be male or female" });
      }
      updates.voice_type = voice_type;
    }

    if (text_size !== undefined) {
      const t = parseInt(text_size);
      if (isNaN(t) || t < 80 || t > 150) {
        return res.status(400).json({ message: "text_size must be 80–150" });
      }
      updates.text_size = t;
    }

    if (dark_mode !== undefined) {
      updates.dark_mode = Boolean(dark_mode);
    }

    await UserSetting.update(updates, { where: { user_id: req.user.id } });

    return res.status(200).json({ message: "Settings updated" });
  } catch (err) {
    console.error("Update settings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getMySettings, updateMySettings };
