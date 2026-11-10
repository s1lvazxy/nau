import { createFileRoute } from '@tanstack/react-router'
import { Landing, landingHead } from '~/components/landing/page'

/** The website in English. `/` is the same page in Portuguese. */
export const Route = createFileRoute('/en')({ head: landingHead, component: Landing })
