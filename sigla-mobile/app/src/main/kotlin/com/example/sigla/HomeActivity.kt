package com.example.sigla

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.widget.GridLayout
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.example.sigla.databinding.ActivityHomeBinding
import com.example.sigla.databinding.ItemHomeCategoryBinding
import com.example.sigla.databinding.ItemHomeRecentBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.TimeZone

/**
 * Launch screen (spec §3, §5). Reads only data already on the phone — history,
 * favorites and the cached word bank — so it works offline and never waits on
 * the network. Recomputed on every onResume so a translation made a moment ago
 * shows up immediately.
 */
class HomeActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHomeBinding
    private lateinit var appSettings: AppSettings

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appSettings = AppSettings.getInstance(this)

        // First launch (or "Replay tutorial"): onboarding comes first and finishes
        // back into Home. Moved here from MainActivity, which is no longer the launcher.
        if (!appSettings.isOnboardingDone) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }

        binding = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(binding.root)

        BottomNavHelper.setup(this, Tab.HOME)
        binding.homeSearch.setOnClickListener { BottomNavHelper.openWordBankSearch(this) }
        binding.cardHero.setOnClickListener { BottomNavHelper.openTranslator(this) }
        binding.btnHeroStart.setOnClickListener { BottomNavHelper.openTranslator(this) }
        binding.btnRecentStart.setOnClickListener { BottomNavHelper.openTranslator(this) }
        binding.tvCategoriesViewAll.setOnClickListener { BottomNavHelper.open(this, Tab.WORD_BANK) }
        binding.tvRecentViewAll.setOnClickListener { BottomNavHelper.open(this, Tab.HISTORY) }

        // Home is the root: back leaves the app. finishAffinity() also closes the
        // other tab screens kept alive behind it by the bottom bar.
        onBackPressedDispatcher.addCallback(this) { finishAffinity() }
    }

    override fun onResume() {
        super.onResume()
        if (::binding.isInitialized) refresh()
    }

    private fun refresh() {
        renderGreeting()

        val historyManager = TranslationHistoryManager.getInstance(this)
        val entries = historyManager.getAll()
        // Favorites/total-translated are on-device and instant; wordsAvailable
        // needs the cached word bank, loaded below with the categories grid, so
        // the stat banner's word count updates in the same pass as the grid.
        binding.tvStatTotal.text = historyManager.getTotalTranslated().toString()
        binding.tvStatFavorites.text = FavoritesManager.getInstance(this).getAll().size.toString()

        renderRecent(recentEntries(entries))

        lifecycleScope.launch {
            val words = withContext(Dispatchers.IO) {
                ModelUpdateManager.loadCachedWordBank(this@HomeActivity)
            }.orEmpty()
            val names = withContext(Dispatchers.IO) {
                ModelUpdateManager.loadCachedCategories(this@HomeActivity)
            }.orEmpty().map { it.name }
            binding.tvStatWords.text = words.size.toString()
            renderCategories(homeCategories(words, names))
        }
    }

    private fun renderGreeting() {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val greeting = homeGreeting(hour, appSettings.userName)
        binding.tvGreetingTitle.text = greeting.title
        binding.tvGreetingSubtitle.text = greeting.subtitle.orEmpty()
        binding.tvGreetingSubtitle.isVisible = greeting.subtitle != null

        val name = appSettings.userName?.trim()?.takeIf { it.isNotEmpty() }
        binding.tvAvatar.isVisible = name != null
        binding.tvAvatar.text = name?.take(1)?.uppercase().orEmpty()
    }

    private fun renderCategories(categories: List<HomeCategory>) {
        val grid = binding.gridCategories
        grid.removeAllViews()
        grid.isVisible = categories.isNotEmpty()
        binding.tvCategoriesEmpty.isVisible = categories.isEmpty()

        val brand = ContextCompat.getColor(this, R.color.sg_brand)
        val onBrand = ContextCompat.getColor(this, R.color.sg_on_brand)
        val onBrandSecondary = ContextCompat.getColor(this, R.color.sg_on_brand_secondary)
        val gap = resources.getDimensionPixelSize(R.dimen.sg_space_12) / 2

        categories.forEachIndexed { index, category ->
            val item = ItemHomeCategoryBinding.inflate(layoutInflater, grid, false)
            item.tvCategoryName.text = category.name.toTitleCase()
            item.tvCategoryCount.text = resources.getQuantityString(
                R.plurals.home_word_count, category.wordCount, category.wordCount
            )
            // The first card is the navy highlight, like the reference.
            if (index == 0) {
                item.root.setCardBackgroundColor(brand)
                item.tvCategoryName.setTextColor(onBrand)
                item.tvCategoryCount.setTextColor(onBrandSecondary)
                item.ivCategoryIcon.imageTintList = ColorStateList.valueOf(onBrand)
            }
            item.root.setOnClickListener {
                startActivity(
                    Intent(this, CategoryWordListActivity::class.java)
                        .putExtra(CategoryWordListActivity.EXTRA_CATEGORY_NAME, category.name)
                )
            }
            val params = GridLayout.LayoutParams(
                GridLayout.spec(GridLayout.UNDEFINED),
                GridLayout.spec(GridLayout.UNDEFINED, 1f),
            ).apply {
                width = 0
                setMargins(gap, gap, gap, gap)
            }
            grid.addView(item.root, params)
        }
    }

    private fun renderRecent(entries: List<TranslationEntry>) {
        binding.listRecent.removeAllViews()
        binding.recentEmpty.isVisible = entries.isEmpty()
        val now = System.currentTimeMillis()
        val zone = TimeZone.getDefault()
        for (entry in entries) {
            val row = ItemHomeRecentBinding.inflate(layoutInflater, binding.listRecent, false)
            row.tvRecentWord.text = entry.word.toTitleCase()
            val day = if (isSameLocalDay(entry.timestamp, now, zone)) "Today"
                      else TranslationHistoryManager.formatDate(entry.timestamp)
            row.tvRecentMeta.text = "$day · ${TranslationHistoryManager.formatTime(entry.timestamp)}"
            row.root.setOnClickListener { BottomNavHelper.open(this, Tab.HISTORY) }
            binding.listRecent.addView(row.root)
        }
    }
}
