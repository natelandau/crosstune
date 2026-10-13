import { Cloud, FileText, Mic, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import {
  INCLUDED_EVERY_DEVICE,
  INCLUDED_EVERY_DEVICE_DETAIL,
  INCLUDED_PRACTICE,
  INCLUDED_PRACTICE_DETAIL,
  INCLUDED_RECORD,
  INCLUDED_RECORD_DETAIL,
  INCLUDED_SCANS,
  INCLUDED_SCANS_DETAIL,
} from './planCopy'

/** One thing Premium holds, as the member view lists it. */
export interface Included {
  title: string
  detail: string
  icon: LucideIcon
}

export const INCLUDED_FEATURES: readonly Included[] = [
  { title: INCLUDED_RECORD, detail: INCLUDED_RECORD_DETAIL, icon: Mic },
  { title: INCLUDED_EVERY_DEVICE, detail: INCLUDED_EVERY_DEVICE_DETAIL, icon: Cloud },
  { title: INCLUDED_PRACTICE, detail: INCLUDED_PRACTICE_DETAIL, icon: SlidersHorizontal },
  { title: INCLUDED_SCANS, detail: INCLUDED_SCANS_DETAIL, icon: FileText },
]
