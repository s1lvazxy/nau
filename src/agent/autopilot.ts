import type { Snapshot } from '~/lib/types'
import { applyChangeSet, mergeChangeSets, type ChangeSet } from '~/data/changeset'
import { runAutopilot } from '~/data/commands'
import { autoResolve } from './executors-admin'

/** One autopilot pass: refresh the suggestions, then let Operator do the paperwork the policy allows. */
export function autopilotPass(s: Snapshot): ChangeSet {
  const found = runAutopilot(s)
  return mergeChangeSets(found, autoResolve(applyChangeSet(s, found)))
}
