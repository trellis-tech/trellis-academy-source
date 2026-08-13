import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'

import academyProxy from '../proxy'
import { GET as getHealth } from '../app/api/health/route'

const readSource = (relativePath) =>
  readFileSync(resolve(import.meta.dir, relativePath), 'utf8')

describe('Trellis Academy shell', () => {
  test('uses the Trellis type contract and Academy identity', () => {
    const rootLayout = readSource('../app/layout.tsx')
    const shell = readSource('../components/Academy/AcademyShell.tsx')

    expect(rootLayout).toContain('Geist')
    expect(rootLayout).toContain("title: 'Trellis Academy'")
    expect(rootLayout).toContain("icon: '/icon.svg'")
    expect(rootLayout).not.toContain('embed-bg.js')
    expect(rootLayout).not.toContain('Wix_Madefor_Text')
    expect(shell).toContain('Trellis Academy')
    expect(shell).toContain('getUriWithOrg')
    expect(shell).toContain('/courses')
    expect(shell).toContain('/trail')
    expect(shell).toContain('/search')
    expect(shell).not.toContain('LearnHouse')
  })

  test('uses the Trellis brand contract on the only sign-in surface', () => {
    const login = readSource('../app/auth/login/page.tsx')

    expect(login).toContain('/icon.svg')
    expect(login).toContain('bg-background')
    expect(login).toContain('border-border')
    expect(login).toContain('bg-academy-accent')
    expect(login).toContain('focus-visible:ring-academy-accent')
    expect(login).not.toContain('bg-white')
    expect(login).not.toContain('shadow')
    expect(login).not.toContain('LearnHouse')
  })

  test('ships an Academy-only translation and provider surface', () => {
    const i18n = readSource('../lib/i18n.ts')
    const providers = readSource('../components/Providers.tsx')
    const academyEnglish = readSource('../locales/academy-en.json')

    expect(i18n).toContain('academy-en.json')
    expect(i18n).not.toContain("../locales/en.json")
    expect(i18n).not.toContain('LOCALE_LOADERS')
    expect(providers).not.toContain('BackgroundTasksProvider')
    expect(providers).not.toContain('BackgroundTasksPanel')
    expect(academyEnglish).not.toContain('LearnHouse')
    expect(academyEnglish).not.toContain('billing')
    expect(academyEnglish).not.toContain('playgrounds')
    expect(academyEnglish).not.toContain('AI credits')
  })

  test('keeps excluded upstream products out of the rendered organization layouts', () => {
    const orgLayout = readSource('../app/orgs/[orgslug]/layout.tsx')
    const menuLayout = readSource('../app/orgs/[orgslug]/(withmenu)/layout.tsx')
    const renderedLayouts = `${orgLayout}\n${menuLayout}`

    for (const excluded of [
      'CompleteSignupFields',
      'OrgJoinBanner',
      'OrgMFAPolicyGate',
      'PodcastPlayer',
      'usePlan',
      'Watermark',
      'learnhouse.app',
      'getGoogleFontUrl',
    ]) {
      expect(renderedLayouts).not.toContain(excluded)
    }

    expect(menuLayout).toContain('AcademyShell')
    expect(menuLayout).toContain('SessionGate')
  })

  test('does not call excluded community or analytics services from the learner journey', () => {
    const learnerSources = [
      '../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/course.tsx',
      '../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/activity.tsx',
    ].map(readSource).join('\n')

    expect(learnerSources).not.toContain('@services/analytics')
    expect(learnerSources).not.toContain('CourseCommunitySection')
  })

  test('keeps the learner course outline on the Academy read-only contract', () => {
    const course = readSource('../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/course.tsx')

    expect(course).toContain('Start course')
    expect(course).toContain('Resume course')
    expect(course).toContain('Course outline')
    expect(course).toContain('@phosphor-icons/react')
    for (const excluded of [
      'CourseActions',
      'CourseShare',
      'CourseAuthors',
      'applyForContributor',
      'removeCourse',
      'useEffect',
      'lucide-react',
      'nice-shadow',
    ]) {
      expect(course).not.toContain(excluded)
    }
  })

  test('keeps the lesson shell free of excluded Academy runtime products', () => {
    const activity = readSource('../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/activity.tsx')

    expect(activity).toContain('AssignmentStudentActivity')
    expect(activity).toContain('Submit for grading')
    expect(activity).toContain('Complete and continue')
    expect(activity).toContain('@phosphor-icons/react')
    for (const excluded of [
      'AIActivityAsk',
      'AIChatBotProvider',
      'AISidePanel',
      'PaidCourseActivityDisclaimer',
      'useContributorStatus',
      'ActivityShareDropdown',
      'lucide-react',
      'nice-shadow',
      'motion/react',
      'react-confetti',
    ]) {
      expect(activity).not.toContain(excluded)
    }
  })

  test('keeps the catalog and search on the Academy read-only launch surface', () => {
    const catalog = readSource('../app/orgs/[orgslug]/(withmenu)/courses/courses.tsx')
    const search = readSource('../app/orgs/[orgslug]/(withmenu)/search/page.tsx')
    const launchPages = `${catalog}\n${search}`

    for (const excluded of [
      'CreateCourseModal',
      'NewCourseButton',
      'usergroups',
      'useLHAnalytics',
      'communities',
      'discussions',
      'playgrounds',
      'podcasts',
      'ApiUser',
    ]) {
      expect(launchPages).not.toContain(excluded)
    }
    expect(catalog).toContain('AcademyCourseCard')
    expect(search).toContain('courses and curriculum folders')
  })

  test('keeps the Academy home on the learner-only course surface', () => {
    const home = readSource('../app/orgs/[orgslug]/(withmenu)/home-client.tsx')
    const landing = readSource('../components/Landings/LandingClassic.tsx')
    const sources = `${home}\n${landing}`

    expect(sources).toContain('AcademyCourseCard')
    for (const excluded of [
      'LandingCustom',
      'CourseThumbnail',
      'NewCourseButton',
      'AuthenticatedClientElement',
      '@services/analytics',
      '/dash',
    ]) {
      expect(sources).not.toContain(excluded)
    }
  })

  test('owner shell uses Academy-specific authority instead of upstream admin roles', () => {
    const page = readSource('../app/orgs/[orgslug]/(withmenu)/owner/page.tsx')
    const serverAuth = readSource('../lib/auth/server.ts')

    expect(page).toContain('getAcademyServerSession')
    expect(page).toContain('hasAcademyRefreshSession')
    expect(page).toContain('/api/auth/refresh?destination=')
    expect(page).toContain("academy_role !== 'owner'")
    expect(page).toContain('Publishing workspace')
    expect(page).toContain('Repository source')
    expect(page).not.toContain('is_superadmin')
    expect(page).not.toContain('/dash')
    expect(serverAuth).toContain('/api/v1/auth/trellis/session')
  })

  test('private folders defer authorization while the refresh-only session rotates', () => {
    const page = readSource('../app/orgs/[orgslug]/(withmenu)/library/folder/[folderid]/page.tsx')
    expect(page).toContain('session?.unresolved')
    expect(page).toContain('/api/auth/refresh?destination=')
  })

  test('lesson metadata does not call authenticated APIs for a refresh-only session', () => {
    const page = readSource('../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/page.tsx')
    expect(page).toContain('session?.unresolved')
    expect(page).toContain('Trellis Academy lesson')
  })

  test('keeps Academy account read-only under Trellis identity authority', () => {
    const account = readSource('../app/orgs/[orgslug]/(withmenu)/account/[subpage]/page.tsx')

    expect(account).toContain('getAcademyServerSession')
    expect(account).toContain("subpage !== 'general'")
    expect(account).toContain('Identity authority')
    expect(account).not.toContain('AccountClient')
    expect(account).not.toContain('password')
    expect(account).not.toContain('purchases')
    expect(account).not.toContain('updateProfile')
  })

  test('keeps progress and certificates read-only and Trellis styled', () => {
    const progress = readSource('../app/orgs/[orgslug]/(withmenu)/trail/trail.tsx')
    const progressCard = readSource('../components/Pages/Trail/TrailCourseCard.tsx')
    const certificates = readSource('../components/Pages/Trail/UserCertificates.tsx')
    const sources = `${progress}\n${progressCard}\n${certificates}`

    expect(sources).not.toContain('removeCourse')
    expect(sources).not.toContain('quitCourse')
    expect(sources).not.toContain('useLHAnalytics')
    expect(sources).not.toContain('nice-shadow')
    expect(sources).not.toContain('lucide-react')
    expect(sources).toContain('@phosphor-icons/react')
  })

  test('verifies credentials in the Trellis Academy shell', () => {
    const verification = readSource('../components/Pages/Certificate/CertificateVerificationPage.tsx')

    expect(verification).toContain('Certificate verified')
    expect(verification).toContain('Trellis Academy')
    expect(verification).toContain('getCertificateByUuid')
    expect(verification).not.toContain('CertificatePreview')
    expect(verification).not.toContain('useTrackView')
    expect(verification).not.toContain('useEffect')
    expect(verification).not.toContain('lucide-react')
    expect(verification).not.toContain('nice-shadow')
    expect(verification).not.toContain('LearnHouse')
  })

  test('limits the learner library to course collections', () => {
    const library = readSource('../app/orgs/[orgslug]/(withmenu)/library/LibraryClient.tsx')
    const folder = readSource('../app/orgs/[orgslug]/(withmenu)/library/folder/[folderid]/FolderClient.tsx')
    const cards = readSource('../app/orgs/[orgslug]/(withmenu)/library/library-cards.tsx')
    const sources = `${library}\n${folder}\n${cards}`

    expect(sources).toContain('AcademyCourseCard')
    expect(sources).toContain("resource_type !== 'courses'")
    for (const excluded of [
      'FeatureGate',
      'useTrackView',
      '@services/analytics',
      'shareFolderLink',
      'MediaLightbox',
      'podcasts',
      'communities',
      'playgrounds',
      'boards',
      'nice-shadow',
    ]) {
      expect(sources).not.toContain(excluded)
    }
  })

  test('uses fixed Academy tenancy without probing the excluded instance API', () => {
    const proxy = readSource('../proxy.ts')

    expect(proxy).not.toContain('instance/info')
    expect(proxy).toContain("mode: 'oss'")
    expect(proxy).toContain("tenancy: 'single'")
    expect(proxy).toContain('getDefaultOrg()')
  })

  test('derives public domain cookies from the request origin', async () => {
    const response = await academyProxy(
      new NextRequest('https://academy.example.test/courses'),
    )
    const cookies = response.headers.getSetCookie().join('\n')

    expect(cookies).toContain('LH_frontend_domain=academy.example.test')
    expect(cookies).toContain('LH_top_domain=academy.example.test')
    expect(cookies).not.toContain('localhost')
  })

  test('renders a Trellis error shell without upstream artwork', () => {
    const notFound = readSource('../app/not-found.tsx')
    const errorBoundary = readSource('../app/error.tsx')
    const errorCatalog = readSource('../lib/errors/catalog.ts')

    expect(notFound).toContain('Trellis Academy')
    expect(notFound).toContain('Back to courses')
    expect(notFound).not.toContain('lrn-text')
    expect(notFound).not.toContain('learnhouse')
    expect(errorBoundary).not.toContain('@services/analytics')
    expect(errorCatalog).toContain('Trellis Academy was released')
    expect(errorCatalog).not.toContain("kind: 'payment'")
    expect(errorCatalog).not.toContain("kind: 'plan_limit'")
    expect(errorCatalog).not.toContain("kind: 'ai'")
  })

  test('keeps learner metadata and dialogs branded and accessible', () => {
    const coursePage = readSource('../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/page.tsx')
    const activityPage = readSource('../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/page.tsx')
    const modal = readSource('../components/Objects/StyledElements/Modal/Modal.tsx')
    const activityBar = readSource('../components/Pages/Activity/FixedActivitySecondaryBar.tsx')

    expect(`${coursePage}\n${activityPage}`).toContain('/trellis-academy.svg')
    expect(`${coursePage}\n${activityPage}`).not.toContain('/lrn-dash.svg')
    expect(coursePage).not.toContain("'LearnHouse'")
    expect(modal).toContain('DialogDescription className="sr-only"')
    expect(activityBar).toContain("course.thumbnail_image\n          ? getCourseThumbnailMediaDirectory")
    expect(activityBar).toContain(": '/trellis-academy.svg'")
  })

  test('excluded upstream browser route entrypoints are absent', () => {
    for (const route of [
      '../app/admin/(dashboard)/page.tsx',
      '../app/admin/login/page.tsx',
      '../app/auth/callback/google/page.tsx',
      '../app/auth/signup/page.tsx',
      '../app/board/[boarduuid]/page.tsx',
      '../app/editor/course/[courseid]/activity/[activityuuid]/edit/page.tsx',
      '../app/embed/[orgslug]/course/[courseuuid]/activity/[activityid]/page.tsx',
      '../app/orgs/[orgslug]/(withmenu)/communities/page.tsx',
      '../app/orgs/[orgslug]/(withmenu)/copilot/page.tsx',
      '../app/orgs/[orgslug]/(withmenu)/playgrounds/page.tsx',
      '../app/orgs/[orgslug]/(withmenu)/podcasts/page.tsx',
      '../app/orgs/[orgslug]/(withmenu)/store/page.tsx',
      '../app/orgs/[orgslug]/dash/page.tsx',
      '../app/payments/stripe/connect/oauth/page.tsx',
    ]) {
      expect(existsSync(resolve(import.meta.dir, route))).toBe(false)
    }
  })

  test('keeps the production web runtime on the Academy launch allowlist', () => {
    const nextConfig = readSource('../next.config.js')
    const providers = readSource('../components/Providers.tsx')
    const proxy = readSource('../proxy.ts')
    const runtimeConfig = readSource('../services/config/config.ts')
    const sentrySources = [
      '../sentry.client.config.ts',
      '../sentry.edge.config.ts',
      '../sentry.server.config.ts',
    ].map(readSource).join('\n')

    expect(providers).not.toContain('PostHogProvider')
    expect(nextConfig).not.toContain("source: '/ingest")
    expect(proxy).not.toContain('|ingest')
    expect(nextConfig).not.toContain("hostname: '**'")
    expect(nextConfig).not.toContain('kind(board|course|podcast|community|playground)')
    expect(nextConfig).not.toContain("'learnhouse-production'")
    expect(nextConfig).toContain('TRELLIS_ACADEMY_RELEASE_SHA')
    expect(nextConfig).toContain('NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL')
    expect(nextConfig).toContain("path.join(publicDir, 'runtime-config.js')")
    expect(nextConfig).not.toContain("process.env.NODE_ENV === 'development'")
    expect(runtimeConfig).not.toContain("require('fs')")
    expect(runtimeConfig).not.toContain('runtime-config.json')
    expect(sentrySources).not.toContain("require(\"fs\")")
    expect(sentrySources).not.toContain('sendDefaultPii: true')
    expect(sentrySources).not.toContain('replayIntegration')
  })

  test('exposes immutable release identity from the web health endpoint', async () => {
    process.env.TRELLIS_ACADEMY_RELEASE_SHA = 'b'.repeat(40)
    process.env.TRELLIS_ACADEMY_MIGRATION_HEAD = 'u4v5w6x7y8z9'
    const response = await getHealth()

    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'healthy',
      revision: 'b'.repeat(40),
      migrationHead: 'u4v5w6x7y8z9',
    }))
    delete process.env.TRELLIS_ACADEMY_RELEASE_SHA
    delete process.env.TRELLIS_ACADEMY_MIGRATION_HEAD
  })
})
