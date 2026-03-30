package com.example.sigla

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.button.MaterialButton

data class OnboardingPage(val icon: String, val title: String, val description: String)

class OnboardingActivity : AppCompatActivity() {

    private lateinit var viewPager: ViewPager2
    private lateinit var btnNext: MaterialButton
    private lateinit var btnSkip: MaterialButton
    private lateinit var indicatorLayout: LinearLayout

    private val pages = listOf(
        OnboardingPage(
            "\uD83D\uDCF7", // camera
            "Main Interface",
            "Point your camera at sign language gestures and SIGLA will instantly translate them to text and speech. Use the flip button to switch cameras, and the Filipino toggle to see translations."
        ),
        OnboardingPage(
            "\uD83D\uDCD6", // book
            "Word Bank",
            "Browse all recognized gestures organized by category. Each word shows a demonstration video and audio pronunciation so you can learn Filipino Sign Language at your own pace."
        ),
        OnboardingPage(
            "\u270D\uFE0F", // writing
            "Suggest a Word",
            "Help expand SIGLA's vocabulary! Submit new words with gesture samples captured from your camera. Your contributions are reviewed by administrators before being added to the system."
        ),
        OnboardingPage(
            "\u2630", // menu
            "Navigation",
            "Use the sidebar menu to access all features: Word Bank, Translation History, Suggest a Word, Notifications, Profile, and Settings. Swipe from the left edge or tap the menu button."
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
        val session = SessionManager.getInstance(this)
        session.isOnboardingDone = true
        startActivity(Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    private fun setupIndicators() {
        for (i in pages.indices) {
            val dot = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(16, 16).apply {
                    marginStart = 8
                    marginEnd = 8
                }
                setBackgroundColor(0x44FFFFFF)
            }
            indicatorLayout.addView(dot)
        }
    }

    private fun updateIndicators(position: Int) {
        for (i in 0 until indicatorLayout.childCount) {
            indicatorLayout.getChildAt(i).setBackgroundColor(
                if (i == position) 0xFF667EEA.toInt() else 0x44FFFFFF
            )
        }
    }
}

class OnboardingAdapter(private val pages: List<OnboardingPage>) :
    RecyclerView.Adapter<OnboardingAdapter.VH>() {

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val icon: TextView = view.findViewById(R.id.tvPageIcon)
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
        holder.icon.text = page.icon
        holder.title.text = page.title
        holder.description.text = page.description
    }

    override fun getItemCount() = pages.size
}
