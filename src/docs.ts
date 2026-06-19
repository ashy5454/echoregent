import './styles.css'
import { initStarfield } from './stars.js'

initStarfield()

// Highlight active sidebar link on scroll
const sections = document.querySelectorAll<HTMLElement>('.doc-section, .doc-category')
const sidebarLinks = document.querySelectorAll<HTMLAnchorElement>('.sidebar-link')

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      const id = e.target.id
      sidebarLinks.forEach(l => {
        l.classList.toggle('active', l.getAttribute('href') === `#${id}`)
      })
    }
  }
}, { rootMargin: '-20% 0px -70% 0px' })

sections.forEach(s => s.id && observer.observe(s))

// Language tab switching (per endpoint)
document.querySelectorAll<HTMLElement>('.lang-tabs').forEach(tabGroup => {
  const panels = tabGroup.nextElementSibling as HTMLElement
  tabGroup.querySelectorAll<HTMLButtonElement>('.lang-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const lang = tab.dataset.lang!
      tabGroup.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      panels?.querySelectorAll('.lang-panel').forEach(p => {
        (p as HTMLElement).classList.toggle('active', (p as HTMLElement).dataset.lang === lang)
      })
    })
  })
})
