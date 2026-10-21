import { ErrorNotice } from "../components/ErrorNotice";
import { BuildCard } from "./BuildCard";
import { EngineConfigCard } from "./EngineConfigCard";
import { KeyCard } from "./KeyCard";
import { LibraryCard } from "./LibraryCard";
import { SearchCard } from "./SearchCard";
import { StylesCard } from "./StylesCard";
import { StyleTestCard } from "./StyleTestCard";
import { ThumbnailsCard } from "./ThumbnailsCard";
import { useAdmin } from "./useAdmin";

/** The Admin Edition page: build the sound library and style packages. Not part of the user build. */
export default function AdminPage() {
  const { overview, error, reload, act } = useAdmin();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="admin-page">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-muted">Library tools for the person who publishes sounds and styles. This page exists only in the Admin Edition.</p>
      </header>
      {error && <ErrorNotice error={error} />}
      {overview ? (
        <>
          <KeyCard keySet={overview.keySet} act={act} />
          <SearchCard keySet={overview.keySet} reload={reload} />
          <LibraryCard overview={overview} act={act} />
          <StylesCard overview={overview} act={act} />
          <StyleTestCard />
          <ThumbnailsCard />
          <EngineConfigCard />
          <BuildCard overview={overview} act={act} />
        </>
      ) : (
        !error && <p className="text-sm text-muted">Loading…</p>
      )}
    </div>
  );
}
