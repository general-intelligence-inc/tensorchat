import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus } from 'lucide-react'
import { SectionWrapper } from './ui/SectionWrapper'
import { AnimateIn } from './ui/AnimateIn'

const faqs = [
  {
    q: 'Is TensorChat really free?',
    a: 'Yes. TensorChat is free to download and use. Models are downloaded from HuggingFace\'s open model repository at no cost.',
  },
  {
    q: 'How much storage do the models need?',
    a: 'The smallest model (Qwen3.5-0.8B Q4) needs about 530 MB. The largest (Qwen3.5-4B Q4) needs about 2.7 GB. You choose which model fits your device.',
  },
  {
    q: 'Does it work without internet?',
    a: 'Yes. After downloading a model, TensorChat works completely offline. The only network features are the optional DuckDuckGo web search and initial model downloads.',
  },
  {
    q: 'What devices are supported?',
    a: 'TensorChat runs on iPhones and iPads with iOS 15.5+ and Android devices. Larger models work best on devices with more RAM.',
  },
  {
    q: 'Is my data really private?',
    a: 'Absolutely. All AI processing happens on your device\'s processor. No data is sent to any server. There are no user accounts, no analytics, and no telemetry.',
  },
  {
    q: 'Can I use my own documents?',
    a: 'Yes. The File Vault lets you import PDFs, text files, and Markdown. An on-device embedding model indexes them for retrieval-augmented generation.',
  },
  {
    q: 'What models are supported?',
    a: 'TensorChat supports the Qwen3.5 family in 0.8B, 2B, and 4B sizes with multiple quantization options. Translation models and voice models are also available.',
  },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left cursor-pointer group"
      >
        <span className="font-display text-base font-medium text-text-primary group-hover:text-accent transition-colors duration-200 pr-8">
          {q}
        </span>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          className="shrink-0"
        >
          <Plus className="w-4 h-4 text-text-tertiary" strokeWidth={1.5} />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
            className="overflow-hidden"
          >
            <p className="text-sm text-text-secondary leading-[1.7] pb-5 max-w-[600px]">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function FAQ() {
  return (
    <SectionWrapper id="faq" className="py-24 lg:py-32" narrow>
      <AnimateIn>
        <span className="block text-xs font-medium tracking-[3px] uppercase text-accent/70 mb-4 text-center font-sans">
          FAQ
        </span>
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.02em] text-center mb-14">
          Common questions
        </h2>
      </AnimateIn>

      <AnimateIn delay={0.1}>
        <div className="border-t border-border-subtle">
          {faqs.map((faq) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </AnimateIn>
    </SectionWrapper>
  )
}
