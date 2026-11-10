import { createFileRoute, notFound } from '@tanstack/react-router'
import { PageShell } from '~/components/marketing/page-shell'
import { msg, tr } from '~/i18n'

const UPDATED = '2026-11-09'

const DOCS: Record<string, { title: string; intro: string; sections: [string, string][] }> = {
  terms: {
    title: msg('Terms of Service'),
    intro: msg('A template. Nau is open-source software; whoever hosts this installation is the party to these terms and should adapt them and have them reviewed. They govern your use of this installation of Nau. By creating an account you agree to them on behalf of your business.'),
    sections: [
      [msg('The service'), msg('Nau provides software to record stock, purchasing, receiving, counts and related analysis, including an AI assistant (“Operator”) that answers questions and prepares changes for your approval. Nau is not invoicing software and does not issue fiscal documents.')],
      [msg('Your account'), msg('You are responsible for the people you invite and the roles you give them, and for keeping your credentials safe. Tell whoever hosts this installation promptly if you suspect unauthorised access.')],
      [msg('Operator and automation'), msg('Operator works from your data and can make mistakes. Actions that change stock, prices or orders are proposed for your approval unless you enable automatic actions under a limit you set. You remain responsible for decisions taken in your business.')],
      [msg('Your data'), msg('You own the data you put into Nau. You can export it at any time. We process it only to provide the service, as described in our Privacy Policy and Data Processing Agreement.')],
      [msg('Acceptable use'), msg('Don’t use Nau to break the law, to infringe others’ rights, or to probe or disrupt the service.')],
      [msg('Availability and changes'), msg('We work to keep Nau available and secure, and we may improve or change features.')],
      [msg('Liability'), msg('The software is provided under the AGPL-3.0 licence, without warranty. Nothing limits liability that cannot be limited under Portuguese law.')],
      [msg('Law and disputes'), msg('These terms are governed by Portuguese law. The courts of Lisbon have jurisdiction, without prejudice to mandatory consumer protection rules.')],
    ],
  },
  privacy: {
    title: msg('Privacy Policy'),
    intro: msg('A template for whoever hosts this installation. It explains what personal data this installation of Nau processes, why, and the rights you have under the GDPR (RGPD).'),
    sections: [
      [msg('Who we are'), msg('The organisation that hosts this installation is the controller for account data, and a processor for the business data you store in your workspace. Contact that organisation for anything about your data.')],
      [msg('What we collect'), msg('Account data (name, email, password hash), workspace data you enter (items, suppliers, movements, documents you upload), and usage data needed to run and secure the service.')],
      [msg('Why'), msg('To provide and secure the service (contract). We do not sell personal data.')],
      [msg('AI processing'), msg('When the AI model is enabled, the messages you send Operator and the documents you ask it to read are sent to our model provider to generate a response. They are not used to train models.')],
      [msg('Where'), msg('Workspace data is stored in the database of this installation, in the place its host chose. Sub-processors are listed in the Data Processing Agreement.')],
      [msg('How long'), msg('We keep your data while your account is active. After you delete a workspace, its data is removed from production systems within 30 days and from backups within 90 days.')],
      [msg('Your rights'), msg('You can access, correct, export or delete your data, object to processing and complain to the Comissão Nacional de Proteção de Dados (CNPD). Write to the organisation that hosts this installation.')],
    ],
  },
  dpa: {
    title: msg('Data Processing Agreement'),
    intro: msg('This agreement applies when Nau processes personal data on behalf of your business (for example, names of staff or suppliers stored in your workspace), under Article 28 GDPR.'),
    sections: [
      [msg('Scope'), msg('Nau processes workspace data only to provide the service and only on your documented instructions, which are the use of the product and these terms.')],
      [msg('Confidentiality and security'), msg('Staff with access are bound by confidentiality. Data is encrypted in transit and at rest, isolated per workspace with row-level security, and access is logged.')],
      [msg('Sub-processors'), msg('Hosting and database, email delivery, and — when enabled — the AI model provider. We will notify you before adding a new sub-processor.')],
      [msg('Assistance and breaches'), msg('We help you answer data subject requests and will notify you without undue delay, and within 48 hours, of a personal data breach affecting your workspace.')],
      [msg('Deletion and audits'), msg('At the end of the service we delete or return your data. We make available the information needed to demonstrate compliance.')],
    ],
  },
}

export const Route = createFileRoute('/legal/$doc')({
  loader: ({ params }) => {
    if (!DOCS[params.doc]) throw notFound()
    return DOCS[params.doc]
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${tr(loaderData?.title ?? 'Legal')} — Nau` }] }),
  component: Legal,
})

function Legal() {
  const doc = Route.useLoaderData()
  return (
    <PageShell>
      <article className="mx-auto max-w-[720px] px-5 pt-16">
        <h1 className="text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.04em]">{tr(doc.title)}</h1>
        <p className="mt-3 text-[13px] text-ink-3">{tr('Last updated {0}', UPDATED)}</p>
        <p className="mt-6 text-[17px] leading-[1.65] text-ink-2">{tr(doc.intro)}</p>
        <div className="mt-12 flex flex-col">
          {doc.sections.map(([h, b], i) => (
            <section key={h} className="grid gap-2 border-t border-line py-6 sm:grid-cols-[180px_1fr]">
              <h2 className="text-[14px] font-medium text-ink">
                <span className="mr-2 font-mono text-[11px] text-ink-4">{String(i + 1).padStart(2, '0')}</span>
                {tr(h)}
              </h2>
              <p className="max-w-[62ch] text-[15px] leading-[1.7] text-ink-2">{tr(b)}</p>
            </section>
          ))}
        </div>
      </article>
    </PageShell>
  )
}
