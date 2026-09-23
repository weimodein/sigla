package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.button.MaterialButton

data class OnboardingPage(
    @DrawableRes val iconRes: Int,
    val eyebrow: String,
    val title: String,
    val description: String
)

class OnboardingActivity : AppCompatActivity() {

    private lateinit var viewPager: ViewPager2
    private lateinit var btnNext: MaterialButton
    private lateinit var btnSkip: MaterialButton
    private lateinit var indicatorLayout: LinearLayout

    private val pages = listOf(
        OnboardingPage(
            R.drawable.ic_camera_line,
            "Translate",
            "Main interface",
            "Ready to translate? Position the person signing in front of the camera and make sure their gestures are clearly visible. SigLa will recognize the signs and provide text and speech translations. You can switch cameras using the Flip Camera button and view Filipino translations by enabling the Filipino toggle."
        ),
        OnboardingPage(
            R.drawable.ic_book_line,
            "Learn",
            "Word bank",
            "Browse recognized sign language gestures organized by category. Tap any word to watch a demonstration video and hear its pronunciation, allowing you to learn and practice Filipino Sign Language at your own pace."
        ),
        OnboardingPage(
            R.drawable.ic_menu_line,
            "Explore",
            "Navigation",
            "Access all of SigLa’s features through the sidebar menu, including the Main Interface, Word Bank, Translation History, and Settings. Swipe from the left edge of the screen or tap the Menu button to open the menu."
        )
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)

        viewPager = findViewById(R.id.viewPager)
        btnNext = findViewById(R.id.btnNext)
        btnSkip = findViewById(R.id.btnSkip)
        indicatorLayout = findViewById(R.id.indicatorLayout)

        viewPager.adapter = OnboardingAdapter(pages)

        setupIndicators()
        updateIndicators(0)

        viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                updateIndicators(position)
                btnNext.text = if (position == pages.size - 1)
                    getString(R.string.get_started) else getString(R.string.next)
            }
        })

        btnNext.setOnClickListener {
            if (viewPager.currentItem < pages.size - 1) {
                viewPager.currentItem = viewPager.currentItem + 1
            } else {
                completeOnboarding()
            }
        }

        btnSkip.setOnClickListener { completeOnboarding() }
    }

    private fun completeOnboarding() {
        AppSettings.getInstance(this).isOnboardingDone = true
        startActivity(Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun setupIndicators() {
        for (i in pages.indices) {
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

    private fun updateIndicators(position: Int) {
        for (i in 0 until indicatorLayout.childCount) {
            val dot = indicatorLayout.getChildAt(i)
            val isActive = i == position
            val params = dot.layoutParams as LinearLayout.LayoutParams
            params.width = if (isActive) dp(20) else dp(7)
            dot.layoutParams = params
            dot.setBackgroundColor(
                if (isActive) ContextCompat.getColor(this, R.color.colorTeal)
                else ContextCompat.getColor(this, R.color.colorIndicatorInactive)
            )
        }
    }
}

class OnboardingAdapter(private val pages: List<OnboardingPage>) :
    RecyclerView.Adapter<OnboardingAdapter.VH>() {

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val icon: ImageView = view.findViewById(R.id.ivIcon)
        val eyebrow: TextView = view.findViewById(R.id.tvPageEyebrow)
        val title: TextView = view.findViewById(R.id.tvPageTitle)
        val description: TextView = view.findViewById(R.id.tvPageDescription)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_onboarding_page, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val page = pages[position]
        holder.icon.setImageResource(page.iconRes)
        holder.eyebrow.text = page.eyebrow
        holder.title.text = page.title
        holder.description.text = page.description
    }

    override fun getItemCount() = pages.size
}
