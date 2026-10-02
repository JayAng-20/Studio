import { zhTW } from './zh-TW'
import { en as enCore } from './en'
import * as player from '@/features/player/i18n'
import * as recorder from '@/features/recorder/i18n'
import * as gif from '@/features/gif/i18n'
import * as convert from '@/features/convert/i18n'
import * as tools from '@/features/tools/i18n'
import * as qr from '@/features/qr/i18n'
import * as pdf from '@/features/pdf/i18n'
import * as doc2pdf from '@/features/doc2pdf/i18n'
import type { DeepString } from './types'

export const zhDict = {
  ...zhTW,
  player: player.zh,
  recorder: recorder.zh,
  gif: gif.zh,
  convert: convert.zh,
  tools: tools.zh,
  qr: qr.zh,
  pdf: pdf.zh,
  doc2pdf: doc2pdf.zh,
}

export type Dict = DeepString<typeof zhDict>

export const enDict: Dict = {
  ...enCore,
  player: player.en,
  recorder: recorder.en,
  gif: gif.en,
  convert: convert.en,
  tools: tools.en,
  qr: qr.en,
  pdf: pdf.en,
  doc2pdf: doc2pdf.en,
}
