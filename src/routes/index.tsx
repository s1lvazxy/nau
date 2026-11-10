import { createFileRoute } from '@tanstack/react-router'
import { Landing, landingHead } from '~/components/landing/page'

/** The website in Portuguese. `/en` is the same page in English. */
export const Route = createFileRoute('/')({ head: landingHead, component: Landing })
