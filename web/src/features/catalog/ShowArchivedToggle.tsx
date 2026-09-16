export function ShowArchivedToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="label text-meta cursor-pointer gap-2">
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Show archived
    </label>
  )
}
