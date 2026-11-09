import { Button } from './Button'
import { Capsule } from './Capsule'
import { IconButton } from './IconButton'
import { Menu } from './Menu'
import { PressableRow } from './PressableRow'
import { RangeHandles } from './RangeHandles'
import { SearchField } from './SearchField'
import { SegmentedChoice } from './SegmentedChoice'
import { Slider } from './Slider'
import { Stepper } from './Stepper'
import { Tabs } from './Tabs'
import { ToolPopover } from './ToolPopover'
import { ButtonRow } from './form/ButtonRow'
import { Checkbox } from './form/Checkbox'
import { FieldRow } from './form/FieldRow'
import { Group } from './form/Group'
import { Picker } from './form/Picker'
import { SuggestField } from './form/SuggestField'
import { Switch } from './form/Switch'
import { TextField } from './form/TextField'

/** Every control in the library. The library page shows each under a heading of its name. */
export const CONTROLS = [
  Button,
  IconButton,
  Tabs,
  PressableRow,
  SegmentedChoice,
  Capsule,
  Switch,
  Checkbox,
  Stepper,
  Slider,
  RangeHandles,
  ToolPopover,
  ButtonRow,
  Group,
  FieldRow,
  TextField,
  Picker,
  SuggestField,
  SearchField,
  Menu,
] as const

/**
 * Every other PascalCase export of `src/ui/*.tsx` and `src/ui/form/*.tsx`, with why the library
 * page has no section for it. The page test fails on an export in neither list.
 */
export const NOT_LIBRARY_CONTROLS: Readonly<Record<string, string>> = {
  ActionButtonRow: 'a row of an app screen, built from Button',
  ConfirmProvider: 'provider; the confirmation shows in the Menu section',
  ControlDescription: 'internal helper that describes a control',
  EmptyState: 'screen filler, not a control',
  FiltersBarButton: 'app list chrome',
  ErrorLine: 'inline message, not a control',
  Mark: 'brand mark',
  Lockup: 'brand mark',
  FilterRow: 'app list chrome',
  KeyGrid: 'app content: a grid of musical keys',
  KeyPill: 'app content: a musical key',
  ListHeader: 'app list chrome',
  MapMessage: 'part of the location map',
  LocationMap: 'app content: a map',
  PopoverDialog: 'overlay container used by other controls',
  PageSection: 'page layout, not a control',
  PressableList: 'the list form of PressableRow, shown in its section',
  PressableOption: 'a row of PressableList, shown in its section',
  PointerOverlay: 'overlay container used by other controls',
  FullScreenCover: 'full-window container whose demo would need app content, such as lyrics',
  MenuAtPoint: 'variant of Menu opened at a point, shown through Menu',
  RangeEdge: 'internal part of RangeHandles',
  RowList: 'list rows are outside the control library',
  Row: 'list rows are outside the control library',
  RowSwipe: 'list row gesture, outside the control library',
  SwipeGroup: 'list row gesture, outside the control library',
  StatusGlyph: 'list rows are outside the control library',
  ActionSlot: 'list row slot, outside the control library',
  SlotButton: 'list row slot, outside the control library',
  TransportMark: 'drawn glyph of a row slot',
  TransportGlyph: 'drawn glyph of a row slot',
  NowPlayingGlyph: 'drawn glyph of a row slot',
  DownloadGlyph: 'drawn glyph of a row slot',
  LinkOutGlyph: 'drawn glyph of a row slot',
  DownloadingGlyph: 'drawn glyph of a row slot',
  RecordingControlGlyph: 'drawn glyph of a row slot',
  LinkControlGlyph: 'drawn glyph of a row slot',
  StatusSplitBar: 'app content: a status chart',
  Sheet: 'overlay container, shown in the Sheets and toasts section',
  Tip: 'tooltip helper, not a control',
  TipTrigger: 'tooltip helper, not a control',
  TraceRing: 'drawn feedback ring, not a control',
  WorkingMark: 'spinner drawn inside Button',
  WorkingStatus: 'status text of a working Button',
  PartialDateField: 'app form field built from library rows',
  StatusSegmentedControl: 'app form field built from SegmentedChoice',
  ToastProvider: 'provider; the toast shows in the Sheets and toasts section',
}
