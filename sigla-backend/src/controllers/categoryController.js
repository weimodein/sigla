const { Op } = require("sequelize");
const { Category, Word } = require("../models/index.js");
const { sequelize } = require("../config/db.js");

// ── GET /api/categories ───────────────────────────────────────
const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.findAll({
      order: [["name", "ASC"]],
    });

    // Attach word count per category (case-insensitive match against Word.category)
    const result = await Promise.all(
      categories.map(async (cat) => {
        const word_count = await Word.count({
          where: sequelize.where(
            sequelize.fn("LOWER", sequelize.col("category")),
            cat.name.toLowerCase(),
          ),
        });
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
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
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

      // Cascade rename: update all Word.category rows that referenced the old name
      await Word.update(
        { category: newName },
        {
          where: sequelize.where(
            sequelize.fn("LOWER", sequelize.col("category")),
            category.name.toLowerCase(),
          ),
          transaction: t,
        },
      );
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

    const word_count = await Word.count({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("category")),
        category.name.toLowerCase(),
      ),
    });

    if (word_count > 0) {
      return res.status(400).json({
        message: `Cannot delete: ${word_count} word(s) use this category`,
        word_count,
      });
    }

    await category.destroy();
    return res.status(200).json({ message: "Category deleted" });
  } catch (err) {
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
