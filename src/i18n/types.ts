/** 把字面字串型別放寬成 string，讓英文字典必須有完全相同的鍵 */
export type DeepString<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>
}

/** 字典的所有葉節點路徑（'a.b.c'） */
export type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>
}[keyof T & string]
