import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMomentErrorMessage,
  getMoments,
  updateMomentStatus,
} from "../../lib/moments/upload";
import { releaseMomentObjectUrls, sortMomentsNewestFirst } from "../../lib/moments/gallery";
import type { Moment, MomentStatus } from "../../lib/moments/types";
import AdminMomentCard from "./AdminMomentCard";
import styles from "./MomentsAdmin.module.css";

type StatusFilter = MomentStatus | "all";

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "hidden", label: "Hidden" },
];

export default function MomentsAdmin() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<{ id: string; status: MomentStatus } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const momentsRef = useRef<Moment[]>([]);

  useEffect(() => {
    momentsRef.current = moments;
  }, [moments]);

  const loadMoments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const nextMoments = await getMoments({ status: "all" });
      setMoments((previousMoments) => {
        releaseMomentObjectUrls(previousMoments);
        return nextMoments;
      });
    } catch (loadError) {
      setError(getMomentErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMoments();

    return () => releaseMomentObjectUrls(momentsRef.current);
  }, [loadMoments]);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      all: moments.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      hidden: 0,
    };

    for (const moment of moments) {
      result[moment.status] += 1;
    }

    return result;
  }, [moments]);

  const visibleMoments = useMemo(
    () =>
      sortMomentsNewestFirst(
        filter === "all"
          ? moments
          : moments.filter((moment) => moment.status === filter),
      ),
    [filter, moments],
  );

  const handleChangeStatus = useCallback(
    async (moment: Moment, status: MomentStatus) => {
      setBusy({ id: moment.id, status });
      setError("");
      setAnnouncement("");

      try {
        const updatedMoment = await updateMomentStatus(moment.id, status);
        setMoments((currentMoments) =>
          currentMoments.map((candidate) => {
            if (candidate.id !== moment.id) {
              return candidate;
            }

            releaseMomentObjectUrls(candidate);
            return updatedMoment;
          }),
        );
        const action = status === "approved" ? "approved" : status === "rejected" ? "rejected" : "hidden";
        setAnnouncement(`${moment.guestName || "Guest"}'s moment was ${action}.`);
      } catch (updateError) {
        setError(getMomentErrorMessage(updateError));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <section className={styles.shell} aria-label="Loading moderation queue" aria-busy="true">
        <div className={styles.skeletonFilters} />
        <div className={styles.grid}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className={styles.skeletonCard} key={index} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell} aria-label="Mock Moments moderation queue">
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter moments by status">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.value}
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              <span>{item.label}</span>
              <strong>{counts[item.value]}</strong>
            </button>
          ))}
        </div>
        <button type="button" className={styles.refresh} onClick={() => void loadMoments()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 6.5V3m0 0h-3.5M16 3a7 7 0 1 0 1 8.6" /></svg>
          Refresh
        </button>
      </div>

      <p className={styles.announcement} aria-live="polite">{announcement}</p>

      {error ? (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void loadMoments()}>Try again</button>
        </div>
      ) : null}

      {!error && visibleMoments.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">
            <svg viewBox="0 0 28 28"><path d="M5 8.5h4l1.4-2h7.2l1.4 2h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" /><circle cx="14" cy="15" r="4" /></svg>
          </span>
          <h2>No {filter === "all" ? "local" : filter} moments yet</h2>
          <p>New guest submissions will appear here when they are shared from the capture page.</p>
        </div>
      ) : null}

      {visibleMoments.length > 0 ? (
        <div className={styles.grid}>
          {visibleMoments.map((moment) => (
            <AdminMomentCard
              key={moment.id}
              moment={moment}
              busyStatus={busy?.id === moment.id ? busy.status : null}
              onChangeStatus={handleChangeStatus}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
