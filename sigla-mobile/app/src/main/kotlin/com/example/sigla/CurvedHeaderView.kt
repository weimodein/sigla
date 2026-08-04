package com.example.sigla

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.widget.FrameLayout
import androidx.core.content.ContextCompat

class CurvedHeaderView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : FrameLayout(context, attrs) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.colorHeaderNavy)
    }
    private val path = Path()

    // How deep the dip at the edges is, in dp — matches the mockup's curve depth
    private val arcDip = 60 * resources.displayMetrics.density

    init {
        setWillNotDraw(false)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        buildPath(w.toFloat(), h.toFloat())
    }

    private fun buildPath(w: Float, h: Float) {
        path.reset()
        path.moveTo(0f, 0f)
        path.lineTo(w, 0f)
        path.lineTo(w, h - arcDip)
        // Control point pulled below the view's bottom edge so the curve's
        // apex lands exactly at h in the center, dipping up to arcDip at the sides
        path.quadTo(w / 2f, h + arcDip, 0f, h - arcDip)
        path.close()
    }

    override fun dispatchDraw(canvas: Canvas) {
        canvas.drawPath(path, paint)
        super.dispatchDraw(canvas)
    }
}