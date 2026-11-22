import './styles.css'
import { initStarfield } from './stars.js'

initStarfield()

// Language tab switching (any stack section)
document.querySelectorAll<HTMLButtonElement>('.uc-lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target!
    const container = btn.closest('.uc-code')!
    container.querySelectorAll('.uc-lang-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    container.querySelectorAll<HTMLElement>('.uc-lang-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.id === target)
    })
  })
})

// Quickstart tab switching on home page (if present)
document.querySelectorAll<HTMLButtonElement>('.qs-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const lang = tab.dataset.lang!
    document.querySelectorAll('.qs-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    document.querySelectorAll<HTMLElement>('.qs-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.lang === lang)
    })
  })
})
