// EchoRegent — shared nav + footer
(function () {
  const LOGO_SVG = `<svg class="er-logo-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="24" cy="24" r="21" stroke="#C2C7CE" stroke-width="1.4"
      stroke-dasharray="13 6 13 6 13 6 13 6" stroke-dashoffset="-2" stroke-linecap="round"/>
    <path d="M24 4 L27.5 20 L24 24 L20.5 20 Z" fill="#5F8F85" opacity="0.92"/>
    <path d="M44 24 L28 27.5 L24 24 L28 20.5 Z" fill="#C2C7CE" opacity="0.70"/>
    <path d="M24 44 L20.5 28 L24 24 L27.5 28 Z" fill="#5F8F85" opacity="0.65"/>
    <path d="M4 24 L20 20.5 L24 24 L20 27.5 Z" fill="#C2C7CE" opacity="0.50"/>
    <circle cx="24" cy="24" r="2.8" fill="#C9A24B"/>
  </svg>`

  const NAV_HTML = `
<nav class="er-nav">
  <div class="er-nav-inner">
    <a class="er-nav-logo" href="/index.html">${LOGO_SVG}<span class="er-nav-wordmark">EchoRegent</span></a>
    <button class="er-nav-toggle" aria-label="Toggle menu">
      <span class="er-hamburger-bar"></span>
      <span class="er-hamburger-bar"></span>
      <span class="er-hamburger-bar"></span>
    </button>
    <div class="er-nav-links">
      <div class="er-dropdown">
        <button class="er-nav-link er-nav-link--dd">Product <span class="er-dd-arrow">▾</span></button>
        <div class="er-dropdown-menu">
          <a href="/product.html"><span class="dd-icon">🔍</span>Context Classifier</a>
          <a href="/product.html#compress"><span class="dd-icon">🗜</span>History Compressor</a>
          <a href="/product.html#cache"><span class="dd-icon">⚡</span>Semantic Cache</a>
          <a href="/product.html#protect"><span class="dd-icon">🛡</span>Protected Zones</a>
          <hr class="er-dropdown-separator"/>
          <a href="/product.html#mcp"><span class="dd-icon">🔌</span>MCP Server</a>
          <a href="/product.html#proxy"><span class="dd-icon">↔</span>OpenAI Proxy</a>
        </div>
      </div>
      <div class="er-dropdown">
        <button class="er-nav-link er-nav-link--dd">Solutions <span class="er-dd-arrow">▾</span></button>
        <div class="er-dropdown-menu">
          <a href="/solutions/customer-support.html"><span class="dd-icon">💬</span>Customer Support</a>
          <a href="/solutions/coding-assistants.html"><span class="dd-icon">💻</span>Coding Assistants</a>
          <a href="/solutions/ai-agents.html"><span class="dd-icon">🤖</span>AI Agents</a>
          <hr class="er-dropdown-separator"/>
          <a href="/enterprise.html"><span class="dd-icon">🏢</span>Enterprise</a>
        </div>
      </div>
      <a href="/research.html" class="er-nav-link">Research</a>
      <a href="/docs.html" class="er-nav-link">Docs</a>
      <a href="/pricing.html" class="er-nav-link">Pricing</a>
      <a href="/blog/index.html" class="er-nav-link">Blog</a>
      <a href="/changelog.html" class="er-nav-link">Changelog</a>
      <span class="er-nav-spacer"></span>
      <a href="/enterprise.html" class="er-nav-link er-nav-link--enterprise">Enterprise</a>
      <a href="/pricing.html#get-key" class="er-btn-nav er-btn-nav-mobile">Get API Key</a>
    </div>
    <a href="/pricing.html#get-key" class="er-btn-nav er-btn-nav-desktop">Get API Key</a>
  </div>
</nav>`

  const FOOTER_HTML = `
<footer class="er-footer">
  <div class="er-footer-inner">
    <div class="er-footer-grid">
      <div class="er-footer-brand">
        ${LOGO_SVG}
        <span class="er-nav-wordmark">EchoRegent</span>
        <p>The context management layer that gives LLMs what remains. Built by Yudi Labs, Hyderabad.</p>
      </div>
      <div class="er-footer-col">
        <div class="er-footer-col-title">Product</div>
        <a href="/product.html">Overview</a>
        <a href="/product.html#classify">Classifier</a>
        <a href="/product.html#compress">Compressor</a>
        <a href="/product.html#cache">Cache</a>
        <a href="/product.html#protect">Protected Zones</a>
        <a href="/product.html#mcp">MCP Server</a>
      </div>
      <div class="er-footer-col">
        <div class="er-footer-col-title">Solutions</div>
        <a href="/solutions/customer-support.html">Customer Support</a>
        <a href="/solutions/coding-assistants.html">Coding Assistants</a>
        <a href="/solutions/ai-agents.html">AI Agents</a>
        <a href="/enterprise.html">Enterprise</a>
      </div>
      <div class="er-footer-col">
        <div class="er-footer-col-title">Resources</div>
        <a href="/research.html">Research</a>
        <a href="/docs.html">Documentation</a>
        <a href="/blog/index.html">Blog</a>
        <a href="/changelog.html">Changelog</a>
        <a href="/security.html">Security</a>
        <a href="https://github.com/ashy5454/echoregent" target="_blank">GitHub ↗</a>
      </div>
      <div class="er-footer-col">
        <div class="er-footer-col-title">Company</div>
        <a href="/about.html">About</a>
        <a href="/enterprise.html">Enterprise</a>
        <a href="/security.html">Security</a>
        <a href="mailto:team@yudi.co.in">Contact</a>
        <a href="mailto:team@yudi.co.in">team@yudi.co.in</a>
      </div>
    </div>
    <div class="er-footer-bottom">
      <span class="er-footer-copy">© 2024 EchoRegent · Yudi Labs, Hyderabad, India</span>
      <div class="er-footer-legal">
        <a href="/security.html">Privacy</a>
        <a href="/security.html">Terms</a>
        <a href="/security.html">Security</a>
      </div>
    </div>
  </div>
</footer>`

  function init() {
    // Inject nav
    const navEl = document.getElementById('er-nav')
    if (navEl) navEl.outerHTML = NAV_HTML
    else document.body.insertAdjacentHTML('afterbegin', NAV_HTML)

    // Inject footer
    const footerEl = document.getElementById('er-footer')
    if (footerEl) footerEl.outerHTML = FOOTER_HTML
    else document.body.insertAdjacentHTML('beforeend', FOOTER_HTML)

    // Highlight active nav link
    const path = window.location.pathname
    document.querySelectorAll('.er-nav-link[href]').forEach(link => {
      const href = link.getAttribute('href')
      if (!href) return
      const page = href.split('/').pop()
      const current = path.split('/').pop() || 'index.html'
      if (page && page !== 'index.html' && current === page) {
        link.classList.add('active')
      }
    })

    // Highlight active sidebar link (docs)
    document.querySelectorAll('.er-sidebar-link').forEach(link => {
      if (link.href === window.location.href) link.classList.add('active')
    })

    // Dropdown: click to open, click outside to close
    document.querySelectorAll('.er-dropdown').forEach(dd => {
      const btn = dd.querySelector('button')
      if (!btn) return
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const isOpen = dd.classList.contains('open')
        // close all
        document.querySelectorAll('.er-dropdown.open').forEach(d => d.classList.remove('open'))
        if (!isOpen) dd.classList.add('open')
      })
    })

    // Hamburger menu toggle
    const toggleBtn = document.querySelector('.er-nav-toggle')
    const navLinks = document.querySelector('.er-nav-links')
    if (toggleBtn && navLinks) {
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation()
        const isOpen = navLinks.classList.contains('open')
        if (isOpen) {
          navLinks.classList.remove('open')
          toggleBtn.classList.remove('open')
        } else {
          navLinks.classList.add('open')
          toggleBtn.classList.add('open')
        }
      })
    }

    document.addEventListener('click', () => {
      document.querySelectorAll('.er-dropdown.open').forEach(d => d.classList.remove('open'))
      if (navLinks && toggleBtn) {
        navLinks.classList.remove('open')
        toggleBtn.classList.remove('open')
      }
    })

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const target = document.querySelector(a.getAttribute('href'))
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
      })
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
