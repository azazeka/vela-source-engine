import { MediaRequest, RawRelease } from '../types';
import { PornolabProvider } from './pornolab-provider';

export class PornolabGayProvider extends PornolabProvider {
  /**
   * Pornolab subforums dedicated to gay video releases:
   *  903: Full Length Movies (Gay)
   * 1755: High-Quality Full Length Movies (Gay DVD & HD)
   * 1765: Full-length Asian Films (Gay)
   * 1787: High-Quality Full Length Asian Movies (Gay DVD & HD)
   * 1767: Classic Gay Films (Pre-1990's)
   * 1763: Clip's & SiteRip's Packs (Gay)
   * 1777: Gay Clips (HD Video)
   * 1691: Clips & Movie Scenes (Gay)
   */
  public static readonly GAY_FORUMS = [
    903,
    1755,
    1765,
    1787,
    1767,
    1763,
    1777,
    1691,
  ];

  constructor(
    customBaseUrl = process.env.PORNOLAB_GAY_URL?.trim() || process.env.PORNOLAB_URL?.trim(),
    cookie = process.env.PORNOLAB_GAY_COOKIE?.trim() || process.env.PORNOLAB_COOKIE?.trim(),
    fetcher: typeof fetch = fetch,
    id = 'pornolab-gay',
    name = 'Pornolab Gay',
    isAdult = true
  ) {
    super(customBaseUrl, cookie, fetcher, id, name, isAdult);
  }

  public override async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && this.fetcher === fetch) {
      return [];
    }

    const rawQuery = request.title?.trim() || request.originalTitle?.trim() || '';
    const isTrending = !rawQuery || rawQuery.toLowerCase() === 'trending' || rawQuery.toLowerCase() === 'popular';

    const forumParams = PornolabGayProvider.GAY_FORUMS.map((f) => `f[]=${f}`).join('&');

    const path = isTrending
      ? `/forum/tracker.php?${forumParams}&o=10&s=2`
      : `/forum/tracker.php?nm=${encodeURIComponent(rawQuery)}&${forumParams}&o=10&s=2`;

    try {
      const { html, mirror } = await this.fetchHtml(path);
      return this.parseReleasesFromHtml(html, mirror);
    } catch (err) {
      console.warn(`[PornolabGayProvider] Search failed for "${rawQuery}": ${(err as Error).message}`);
      return [];
    }
  }
}
