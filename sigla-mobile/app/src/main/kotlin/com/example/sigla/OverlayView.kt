package com.example.sigla

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

// Hand connections (MediaPipe landmark indices)
private val CONNECTIONS = listOf(
    0 to 1, 1 to 2, 2 to 3, 3 to 4,
    0 to 5, 5 to 6, 6 to 7, 7 to 8,
    0 to 9, 9 to 10, 10 to 11, 11 to 12,
    0 to 13, 13 to 14, 14 to 15, 15 to 16,
    0 to 17, 17 to 18, 18 to 19, 19 to 20,
    5 to 9, 9 to 13, 13 to 17
)

class OverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#00E676")
        style = Paint.Style.FILL
    }
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#69F0AE")
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }
    private val dot2Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#FF9800")
        style = Paint.Style.FILL
    }
    private val line2Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#FFB74D")
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }

    private var landmarks: List<List<Pair<Float, Float>>> = emptyList()
    private var srcWidth  = 1f
    private var srcHeight = 1f

    fun setLandmarks(lms: List<List<Pair<Float, Float>>>, w: Float, h: Float) {
        landmarks = lms
        srcWidth  = w
        srcHeight = h
        invalidate()
    }

    fun clear() {
        landmarks = emptyList()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val scaleX = width / srcWidth
        val scaleY = height / srcHeight

        for ((handIdx, hand) in landmarks.withIndex()) {
            val dp = if (handIdx == 0) dotPaint  else dot2Paint
            val lp = if (handIdx == 0) linePaint else line2Paint

            // Draw connections
            for ((a, b) in CONNECTIONS) {
                if (a < hand.size && b < hand.size) {
                    canvas.drawLine(
                        hand[a].first  * srcWidth  * scaleX,
                        hand[a].second * srcHeight * scaleY,
                        hand[b].first  * srcWidth  * scaleX,
                        hand[b].second * srcHeight * scaleY,
                        lp
                    )
                }
            }
            // Draw dots
            for ((x, y) in hand) {
                canvas.drawCircle(
                    x * srcWidth  * scaleX,
                    y * srcHeight * scaleY,
                    6f, dp
                )
            }
        }
    }
}
