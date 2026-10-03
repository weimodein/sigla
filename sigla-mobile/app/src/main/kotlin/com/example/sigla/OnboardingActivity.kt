package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText

/**
 * One onboarding feature page (Translate / Learn / Explore): its illustration
 * (an illus_onboard_* vector drawn in sg_* colours, so it follows dark mode),
 * what that illustration shows for screen readers, and the page copy.
 */
data class OnboardingPage(
    @DrawableRes val illustrationRes: Int,
    val illustrationDescription: String,
    val eyebrow: String,
    val title: String,
    val description: String,
)

/**
 * Whether the final "What should we call you?" step should be shown.
 * A returning user who already has a name set (e.g. replaying the tutorial
 * from Settings) is not re-asked — only a fresh install, or someone who
 * skipped the step before, sees it.
 */
internal fun shouldShowNameStep(existingUserName: String?): Boolean =
    existingUserName.isNullOrBlank()

/** The 3 feature pages, in order. A top-level val so it's directly testable. */
internal val featurePages = listOf(
    OnboardingPage(
        R.drawable.illus_onboard_translate,
        "A phone tracking an open hand and answering with a speech bubble",
        "Translate",
        "Sign, and SigLa speaks",
        "Point your camera at someone signing. SigLa reads the sign and says the word out loud, in English or Filipino.",
    ),
    OnboardingPage(
        R.drawable.illus_onboard_learn,
        "A word card with a demo video, a letter and a favourite star",
        "Learn",
        "A word bank at your pace",
        "Browse Filipino Sign Language words by category, watch each sign, and hear it spoken. Save videos to learn offline.",
    ),
    OnboardingPage(
        R.drawable.illus_onboard_explore,
        "Tiles for Home, Word Bank, History and Settings",
        "Explore",
        "Everything, one tap away",
        "Home for your shortcuts, Word Bank to learn, History for what you've translated, and Settings to make it yours.",
    ),
)

class OnboardingActivity : AppCompatActivity() {

    private lateinit var appSettings: AppSettings
    private lateinit var viewPager: ViewPager2
    private lateinit var btnNext: MaterialButton
    private lateinit var btnSkip: MaterialButton
    private lateinit var indicatorLayout: LinearLayout
    private lateinit var tvStepCount: TextView

    /** Set once in onCreate: featurePages, plus the name step if it should show. */
    private var showNameStep = false
    private val pageCount get() = featurePages.size + if (showNameStep) 1 else 0

    // The name field lives only on the name page's view, which RecyclerView can
    // recycle or recreate (e.g. a dark-mode toggle mid-onboarding), so its text
    // is mirrored here as the user types and survives that via onSaveInstanceState.
    private var pendingName: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)

        appSettings = AppSettings.getInstance(this)
        showNameStep = shouldShowNameStep(appSettings.userName)
        pendingName = savedInstanceState?.getString(STATE_PENDING_NAME)

        viewPager = findViewById(R.id.viewPager)
        btnNext = findViewById(R.id.btnNext)
        btnSkip = findViewById(R.id.btnSkip)
        indicatorLayout = findViewById(R.id.indicatorLayout)
        tvStepCount = findViewById(R.id.tvStepCount)

        viewPager.adapter = OnboardingAdapter(
            pages = featurePages,
            showNameStep = showNameStep,
            initialName = pendingName,
            onNameChanged = { pendingName = it },
            onNameDone = { goToNextOrFinish() },
        )

        setupIndicators()
        updateStep(0)
        // onPageSelected(0) isn't reliably fired for the initial page during
        // ViewPager2's first layout pass, so the first page's entrance is
        // triggered explicitly once that layout has actually happened.
        viewPager.post { animatePageEntrance(0) }

        viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                updateStep(position)
                animatePageEntrance(position)
            }
        })

        btnNext.setOnClickListener { goToNextOrFinish() }
        btnSkip.setOnClickListener { completeOnboarding(userName = null) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_PENDING_NAME, pendingName)
    }

    private fun goToNextOrFinish() {
        if (viewPager.currentItem < pageCount - 1) {
            viewPager.currentItem = viewPager.currentItem + 1
        } else {
            completeOnboarding(pendingName)
        }
    }

    private fun completeOnboarding(userName: String?) {
        if (userName != null) appSettings.userName = userName
        appSettings.isOnboardingDone = true
        startActivity(Intent(this, HomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun setupIndicators() {
        for (i in 0 until pageCount) {
            val dot = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(7), dp(7)).apply {
                    marginStart = dp(4)
                    marginEnd = dp(4)
                }
                background = ContextCompat.getDrawable(context, R.drawable.bg_indicator_dot)
            }
            indicatorLayout.addView(dot)
        }
    }

    private fun updateStep(position: Int) {
        for (i in 0 until indicatorLayout.childCount) {
            val dot = indicatorLayout.getChildAt(i)
            val isActive = i == position
            val params = dot.layoutParams as LinearLayout.LayoutParams
            params.width = if (isActive) dp(20) else dp(7)
            dot.layoutParams = params
            dot.setBackgroundColor(
                if (isActive) ContextCompat.getColor(this, R.color.sg_brand)
                else ContextCompat.getColor(this, R.color.sg_divider)
            )
        }

        val isLastPage = position == pageCount - 1
        btnNext.text = getString(if (isLastPage) R.string.get_started else R.string.next)
        // Once on the last page with no name step left to skip, Skip has
        // nothing left to do; every other page (including the name step
        // itself, which Skip just leaves blank) keeps it visible.
        btnSkip.visibility = if (isLastPage && !showNameStep) View.INVISIBLE else View.VISIBLE

        tvStepCount.text = getString(R.string.onboarding_step_count, position + 1, pageCount)
    }

    /**
     * Fades and slides the newly-shown feature page's illustration in. A no-op
     * for the name page (no illustration) and when the page's view isn't
     * attached yet (a page that hasn't been laid out has nothing to animate).
     */
    private fun animatePageEntrance(position: Int) {
        if (position >= featurePages.size) return
        // ViewPager2 hosts its own RecyclerView as its one child; that's how
        // its pages' views are reached from the outside.
        val innerRecycler = viewPager.getChildAt(0) as? RecyclerView ?: return
        val pageView = innerRecycler.findViewHolderForAdapterPosition(position)?.itemView ?: return
        val illustration = pageView.findViewById<View>(R.id.ivIllustration)

        // Cancels any animation still in flight from a fast swipe back onto this
        // page, so the reset below doesn't visibly snap it backward mid-animation.
        illustration.animate().cancel()
        illustration.alpha = 0f
        illustration.translationY = dp(20).toFloat()
        illustration.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(Motion.EMPHASIS)
            .setInterpolator(Motion.STANDARD_EASE)
            .start()
    }

    private companion object {
        const val STATE_PENDING_NAME = "pending_name"
    }
}

internal const val VIEW_TYPE_FEATURE = 0
internal const val VIEW_TYPE_NAME = 1

class OnboardingAdapter(
    private val pages: List<OnboardingPage>,
    private val showNameStep: Boolean,
    private val initialName: String?,
    private val onNameChanged: (String) -> Unit,
    private val onNameDone: () -> Unit,
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    class FeatureVH(view: View) : RecyclerView.ViewHolder(view) {
        val illustration: ImageView = view.findViewById(R.id.ivIllustration)
        val eyebrow: TextView = view.findViewById(R.id.tvPageEyebrow)
        val title: TextView = view.findViewById(R.id.tvPageTitle)
        val description: TextView = view.findViewById(R.id.tvPageDescription)
    }

    class NameVH(view: View) : RecyclerView.ViewHolder(view) {
        val nameField: TextInputEditText = view.findViewById(R.id.etUserName)
        // Listeners are wired once per holder, not per bind — RecyclerView can
        // rebind the same holder (e.g. after a notifyItemChanged), and
        // doAfterTextChanged/setOnEditorActionListener would otherwise stack.
        var listenersWired = false
    }

    override fun getItemViewType(position: Int): Int =
        if (position < pages.size) VIEW_TYPE_FEATURE else VIEW_TYPE_NAME

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
        when (viewType) {
            VIEW_TYPE_NAME -> NameVH(
                LayoutInflater.from(parent.context).inflate(R.layout.item_onboarding_name, parent, false)
            )
            else -> FeatureVH(
                LayoutInflater.from(parent.context).inflate(R.layout.item_onboarding_page, parent, false)
            )
        }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (holder) {
            is FeatureVH -> {
                val page = pages[position]
                holder.illustration.setImageResource(page.illustrationRes)
                holder.illustration.contentDescription = page.illustrationDescription
                holder.eyebrow.text = page.eyebrow
                holder.title.text = page.title
                holder.description.text = page.description
            }
            is NameVH -> {
                // setText before wiring the listener so restoring a saved name
                // doesn't immediately re-report itself as a "change".
                if (holder.nameField.text.isNullOrEmpty() && !initialName.isNullOrEmpty()) {
                    holder.nameField.setText(initialName)
                }
                if (!holder.listenersWired) {
                    holder.listenersWired = true
                    holder.nameField.doAfterTextChanged { onNameChanged(it?.toString().orEmpty()) }
                    holder.nameField.setOnEditorActionListener { _, actionId, _ ->
                        if (actionId == EditorInfo.IME_ACTION_DONE) {
                            onNameDone()
                            true
                        } else {
                            false
                        }
                    }
                }
            }
        }
    }

    override fun getItemCount(): Int = pages.size + if (showNameStep) 1 else 0
}
