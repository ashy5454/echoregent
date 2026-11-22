// Shared starfield animation — import this on any page that has <canvas id="stars">
export function initStarfield() {
  const canvas = document.getElementById('stars') as HTMLCanvasElement | null
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  type Star = { x: number; y: number; r: number; vx: number; vy: number; alpha: number }
  let stars: Star[] = []

  function resize() {
    canvas!.width = window.innerWidth
    canvas!.height = window.innerHeight
  }

  function init() {
    stars = Array.from({ length: 180 }, () => ({
      x: Math.random() * canvas!.width,
      y: Math.random() * canvas!.height,
      r: Math.random() * 1.1 + 0.3,
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.1,
      alpha: Math.random() * 0.45 + 0.12,
    }))
  }

  function animate() {
    ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
    for (const s of stars) {
      s.x += s.vx; s.y += s.vy
      if (s.x < 0) s.x = canvas!.width
      if (s.x > canvas!.width) s.x = 0
      if (s.y < 0) s.y = canvas!.height
      if (s.y > canvas!.height) s.y = 0
      ctx!.beginPath()
      ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx!.fillStyle = `rgba(255,255,255,${s.alpha})`
      ctx!.fill()
    }
    requestAnimationFrame(animate)
  }

  resize(); init(); animate()
  window.addEventListener('resize', () => { resize(); init() })
}
