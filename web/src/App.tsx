import { useState, useEffect } from 'react'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { ModelShowcase } from './components/ModelShowcase'
import { BenchmarkSection } from './components/BenchmarkSection'
import { GettingStarted } from './components/GettingStarted'
import { FeatureGrid } from './components/FeatureGrid'
import { PrivacySection } from './components/PrivacySection'
import { FAQ } from './components/FAQ'
import { CTASection } from './components/CTASection'
import { Footer } from './components/Footer'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'

function useRoute() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)

    // Intercept link clicks for SPA navigation
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return
      e.preventDefault()
      window.history.pushState({}, '', href)
      setPath(href)
      window.scrollTo(0, 0)
    }

    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('click', onClick)
    }
  }, [])

  return path
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-base text-text-primary font-sans">
      <Navbar />
      <main>
        <Hero />
        <ModelShowcase />
        <BenchmarkSection />
        <GettingStarted />
        <FeatureGrid />
        <PrivacySection />
        <FAQ />
        <CTASection />
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  const path = useRoute()

  switch (path) {
    case '/privacy':
      return <PrivacyPolicy />
    case '/terms':
      return <TermsOfService />
    default:
      return <LandingPage />
  }
}
