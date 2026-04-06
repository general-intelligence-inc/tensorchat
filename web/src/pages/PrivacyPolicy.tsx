import { Footer } from '../components/Footer'

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-base text-text-primary font-sans">
      {/* Simple nav */}
      <header className="border-b border-border-subtle">
        <nav className="max-w-3xl mx-auto px-6 md:px-8 h-16 flex items-center">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/icon-ready.png" alt="TensorChat" className="w-7 h-7 rounded-lg" />
            <span className="font-display text-lg font-semibold text-text-primary tracking-tight">
              TensorChat
            </span>
          </a>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 md:px-8 py-16 lg:py-24">
        <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight mb-3">
          Privacy Policy
        </h1>
        <p className="text-sm text-text-tertiary mb-12">Last updated: March 30, 2026</p>

        <div className="prose-custom space-y-8 text-text-secondary leading-[1.8] text-[15px]">
          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Overview</h2>
            <p>
              TensorChat is designed with privacy as its core principle. All AI inference runs entirely
              on your device. We do not collect, store, transmit, or have access to any of your data.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Data Collection</h2>
            <p>
              TensorChat does <strong className="text-text-primary">not</strong> collect any personal data. Specifically:
            </p>
            <ul className="list-disc list-inside space-y-1.5 mt-3">
              <li>No user accounts are created or required</li>
              <li>No analytics or telemetry data is collected</li>
              <li>No crash reports are sent automatically</li>
              <li>No usage data is tracked</li>
              <li>No advertising identifiers are used</li>
              <li>No cookies or tracking technologies are employed</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">On-Device Processing</h2>
            <p>
              All AI language model inference happens locally on your device's processor. Your conversations,
              prompts, and responses are never sent to any external server. Chat history is stored only
              on your device and can be deleted at any time.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Network Usage</h2>
            <p>TensorChat only uses network connectivity for the following purposes:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-3">
              <li><strong className="text-text-primary">Model downloads:</strong> AI models are downloaded from HuggingFace's public repositories when you choose to download them. Only the model files are transferred.</li>
              <li><strong className="text-text-primary">Optional web search:</strong> If you enable the web search feature, search queries are sent to DuckDuckGo. This feature is disabled by default and must be explicitly enabled per conversation.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Document Processing</h2>
            <p>
              Documents imported into the File Vault feature are processed entirely on-device.
              Embeddings for retrieval-augmented generation (RAG) are computed locally and stored
              only on your device. No document content is ever transmitted externally.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Voice Data</h2>
            <p>
              Speech-to-text (Whisper) and text-to-speech (Piper/Kokoro) processing happens entirely
              on-device. No audio recordings or transcriptions are sent to any server.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Third-Party Services</h2>
            <p>
              TensorChat does not integrate with any third-party analytics, advertising, or tracking
              services. The only third-party interaction is the optional DuckDuckGo web search feature,
              which is governed by DuckDuckGo's own privacy policy.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Children's Privacy</h2>
            <p>
              TensorChat does not knowingly collect any information from anyone, including children
              under the age of 13. Since no data is collected, no special provisions are necessary.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Any changes will be reflected on
              this page with an updated revision date. Since we do not collect contact information,
              we cannot notify users directly of changes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-text-primary mb-3">Contact</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:support@tensorchat.app" className="text-accent hover:underline">
                support@tensorchat.app
              </a>.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}
