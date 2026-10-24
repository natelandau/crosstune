import type { PickerOption } from './Picker'

/** A closed vocabulary as picker options, each value its own label. */
export const asOptions = (values: readonly string[]): PickerOption[] =>
  values.map((value) => ({ id: value, label: value }))
