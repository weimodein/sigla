package com.example.sigla

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import kotlin.math.max

private val CONNECTIONS = listOf(
    0 to 1, 1 to 2, 2 to 3, 3 to 4,
    0 to 5, 5 to 6, 6 to 7, 7 to 8,
    0 to 9, 9 to 10, 10 to 11, 11 to 12,
    0 to 13, 13 to 14, 14 to 15, 15 to 16,
    0 to 17, 17 to 18, 18 to 19, 19 to 20,
    5 to 9, 9 to 13, 13 to 17
)

internal data class FillCenterTransform(
    val scale: Float,
    val offsetX: Float,
    val offsetY: Float,
)

/** Same uniform scale + centred crop used by PreviewView.ScaleType.FILL_CENTER. */
internal fun fillCenterTransform(
    sourceWidth: Float,
    sourceHeight: Float,
    viewWidth: Float,
    viewHeight: Float,
): FillCenterTransform {
    if (sourceWidth <= 0f || sourceHeight <= 0f) {
        return FillCenterTransform(1f, 0f, 0f)
    }
    val scale = max(viewWidth / sourceWidth, viewHeight / sourceHeight)
    return FillCenterTransform(
        scale = scale,
        offsetX = (viewWidth - sourceWidth * scale) / 2f,
        offsetY = (viewHeight - sourceHeight * scale) / 2f,
    )
}

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

    // Each hand is a flat FloatArray of interleaved x,y (42 floats). landmark i = (arr[2i], arr[2i+1]).
    private var landmarks: List<FloatArray> = emptyList()
    private var srcWidth = 1f
    private var srcHeight = 1f
    private var isMirrored = false  // NEW: track mirroring state

    /** Called from MainActivity to update hand landmarks and redraw. */
    fun setLandmarks(lms: List<FloatArray>, w: Float, h: Float, mirrored: Boolean = false) {
        landmarks = lms
        srcWidth = w
        srcHeight = h
        isMirrored = mirrored
        invalidate()
    }

    /** Called from MainActivity to wipe landmarks when no hands are detected. */
    fun clear() {
        landmarks = emptyList()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val transform = fillCenterTransform(
            srcWidth, srcHeight, width.toFloat(), height.toFloat()
        )

        fun drawX(normalizedX: Float): Float {
            val x = transform.offsetX + normalizedX * srcWidth * transform.scale
            return if (isMirrored) width - x else x
        }

        fun drawY(normalizedY: Float): Float =
            transform.offsetY + normalizedY * srcHeight * transform.scale

        for ((handIdx, hand) in landmarks.withIndex()) {
            val dp = if (handIdx == 0) dotPaint else dot2Paint
            val lp = if (handIdx == 0) linePaint else line2Paint
            val n = hand.size / 2  // number of landmarks (interleaved x,y)

            for ((a, b) in CONNECTIONS) {
                if (a < n && b < n) {
                    canvas.drawLine(
                        drawX(hand[a * 2]),
                        drawY(hand[a * 2 + 1]),
                        drawX(hand[b * 2]),
                        drawY(hand[b * 2 + 1]),
                        lp
                    )
                }
            }
            for (i in 0 until n) {
                canvas.drawCircle(
                    drawX(hand[i * 2]),
                    drawY(hand[i * 2 + 1]),
                    6f, dp
                )
            }
        }
    }
}
