// A template re-mounts on every navigation (unlike layout), so this wrapper's
// CSS fade replays on each route change — a zero-JS page transition.
// flex-col/flex-1 preserves the body's column layout for inner `flex-1` mains.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-1 flex-col">{children}</div>;
}
