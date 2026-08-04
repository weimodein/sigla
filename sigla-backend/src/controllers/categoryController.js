const { Op } = require("sequelize");
const { Category, Word } = require("../models/index.js");
const { sequelize } = require("../config/db.js");
const { logActivity } = require("../utils/activityLogger.js");
const { validateCategoryName } = require("../utils/validators.js");

// ── GET /api/categories ───────────────────────────────────────
const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.findAll({
      order: [["name", "ASC"]],
    });

    // Attach word count per category — a plain FK count now.
    const result = await Promise.all(
      categories.map(async (cat) => {
        const word_count = await Word.count({ where: { category_id: cat.id } });
        return {
          id: cat.id,
          name: cat.name,
          description: cat.description,
          word_count,
          created_at: cat.created_at,
          updated_at: cat.updated_at,
        };
      }),
    );

    return res.status(200).json({ categories: result });
  } catch (err) {
    console.error("getAllCategories error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── POST /api/categories ──────────────────────────────────────
const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const nameError = validateCategoryName(name);
    if (nameError) {
      return res.status(400).json({ message: nameError });
    }
    const trimmed = name.trim();

    // Case-insensitive duplicate check
    const existing = await Category.findOne({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("name")),
        trimmed.toLowerCase(),
      ),
    });
    if (existing) {
      return res.status(409).json({ message: "Category already exists" });
    }

    const category = await Category.create({
      name: trimmed,
      description: description?.trim() || null,
    });

    await logActivity({
      administrator_id: req.user.id,
      action: "added_category",
      target_type: "category",
      target_id: category.id,
      details: `Added category: ${category.name}`,
    });

    return res.status(201).json({ category });
  } catch (err) {
    console.error("createCategory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── PUT /api/categories/:id ───────────────────────────────────
const updateCategory = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { name, description } = req.body;
    const category = await Category.findByPk(req.params.id, { transaction: t });
    if (!category) {
      await t.rollback();
      return res.status(404).json({ message: "Category not found" });
    }

    let newName = category.name;
    if (name && name.trim() && name.trim() !== category.name) {
      const nameError = validateCategoryName(name);
      if (nameError) {
        await t.rollback();
        return res.status(400).json({ message: nameError });
      }
      newName = name.trim();

      // Duplicate check (excluding this row)
      const existing = await Category.findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn("LOWER", sequelize.col("name")),
              newName.toLowerCase(),
            ),
            { id: { [Op.ne]: category.id } },
          ],
        },
        transaction: t,
      });
      if (existing) {
        await t.rollback();
        return res.status(409).json({ message: "Category name already exists" });
      }

      // No cascade needed: words reference category_id, so they follow a rename
      // automatically. (Previously this hand-updated every Word.category row.)
    }

    await category.update(
      {
        name: newName,
        description:
          description !== undefined ? description?.trim() || null : category.description,
      },
      { transaction: t },
    );

    await t.commit();

    await logActivity({
      administrator_id: req.user.id,
      action: "updated_category",
      target_type: "category",
      target_id: category.id,
      details: `Updated category: ${newName}`,
    });

    return res.status(200).json({ category });
  } catch (err) {
    await t.rollback();
    console.error("updateCategory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE /api/categories/:id ────────────────────────────────
const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Friendly pre-check. The FK's ON DELETE RESTRICT enforces this at the DB
    // level too, so the catch below still guards against a race.
    const word_count = await Word.count({ where: { category_id: category.id } });

    if (word_count > 0) {
      return res.status(400).json({
        message: `Cannot delete: ${word_count} word(s) use this category`,
        word_count,
      });
    }

    const deletedName = category.name;
    const deletedId = category.id;
    await category.destroy();

    await logActivity({
      administrator_id: req.user.id,
      action: "deleted_category",
      target_type: "category",
      target_id: deletedId,
      details: `Deleted category: ${deletedName}`,
    });

    return res.status(200).json({ message: "Category deleted" });
  } catch (err) {
    // A foreign-key violation means words were attached between the check and
    // the delete — surface the same clear message rather than a bare 500.
    if (err.name === "SequelizeForeignKeyConstraintError") {
      return res.status(400).json({
        message: "Cannot delete: words are still assigned to this category",
      });
    }
    console.error("deleteCategory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
