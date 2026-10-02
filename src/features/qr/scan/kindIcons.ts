import {
  CalendarDays,
  Contact,
  Link2,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Type,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import type { ScanKind } from '../lib/parse'

export const KIND_ICONS: Record<ScanKind, LucideIcon> = {
  url: Link2,
  wifi: Wifi,
  contact: Contact,
  email: Mail,
  tel: Phone,
  sms: MessageSquareText,
  geo: MapPin,
  event: CalendarDays,
  text: Type,
}
