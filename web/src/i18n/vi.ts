/**
 * Vietnamese copy for every UI surface (T031, FR-065/SC-011).
 *
 * The dictionary is the single source of UI strings: components and pages
 * must not hardcode Vietnamese prose. Review content posted to GitHub stays
 * server-side English and never flows through here.
 */
export const VI = {
  app: {
    title: 'PR Review Dashboard',
    subtitle: 'Bảng review pull request hỗ trợ bởi AI — chạy cục bộ 100%.',
    offline: 'Mất kết nối tới máy chủ — dữ liệu có thể đã cũ, thao tác ghi bị tắt.',
    reconnecting: 'Đang kết nối lại tới máy chủ…',
    online: 'Đã kết nối.',
  },
  lanes: {
    Draft: 'Draft',
    'In review': 'Đang review',
    'Request changes': 'Yêu cầu chỉnh sửa',
    Approved: 'Đã duyệt',
    Done: 'Hoàn tất',
  },
  board: {
    searchPlaceholder: 'Tìm tiêu đề, tác giả, nhãn…',
    filterByLabel: 'Lọc theo nhãn',
    allRepositories: 'Tất cả repository',
    emptyTitle: 'Chưa có pull request nào',
    emptyBody: 'Kết nối một repository và chạy đồng bộ để populate bảng.',
    connectRepository: 'Kết nối repository',
    sync: 'Đồng bộ ngay',
    syncing: 'Đang đồng bộ…',
  },
  states: {
    loading: 'Đang tải…',
    errorTitle: 'Đã xảy ra lỗi',
    retry: 'Thử lại',
    empty: 'Không có dữ liệu',
  },
  pr: {
    size: 'Kích thước',
    author: 'Tác giả',
    checks: 'Kiểm tra',
    reviews: 'Review',
    mergeable: 'Có thể merge',
    conflicting: 'Xung đột',
    unknown: 'Không xác định',
    openDiff: 'Xem diff',
    prepareDiff: 'Chuẩn bị diff',
    aiReviewTab: 'Review AI',
    activityTab: 'Hoạt động',
    changesTab: 'Code',
    draftTab: 'Dự thảo',
  },
  actions: {
    dismiss: 'Đóng',
    cancel: 'Hủy',
    confirm: 'Xác nhận',
    viewDetails: 'Xem chi tiết',
  },
  errors: {
    AUTH_MISSING: 'Thiếu thông tin xác thực GitHub',
    AUTH_INVALID: 'Thông tin xác thực GitHub không hợp lệ',
    PERMISSION_DENIED: 'Không đủ quyền thực hiện thao tác này',
    RATE_LIMITED: 'Đã đạt giới hạn GitHub; thử lại sau thời điểm báo trước',
    OFFLINE: 'Mạng không khả dụng hoặc máy chủ cục bộ chưa chạy',
    NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu',
    CONFLICT: 'Trạng thái đã thay đổi; hãy làm mới dữ liệu',
    STALE_HEAD: 'Commit head đã thay đổi trên GitHub; cần đồng bộ lại',
    PR_CLOSED: 'Pull request đã đóng hoặc merge',
    PREVIEW_EXPIRED: 'Bản xem trước đã hết hạn; hãy tạo lại',
    PREVIEW_MISMATCH: 'Bản xem trước không còn khớp trạng thái hiện tại',
    PUBLISH_IN_FLIGHT: 'Có một lần đăng bài đang chạy; vui lòng chờ',
    AI_FAILED: 'Lần review AI thất bại',
    AI_INVALID_OUTPUT: 'AI trả về dữ liệu không hợp lệ; chạy lại để có kết quả mới',
    GIT_MISSING: 'Chưa cài Git trên máy này',
    GIT_PREP_FAILED: 'Chuẩn bị bản sao Git thất bại',
    SECRET_EXCLUDED: 'Nội dung chứa thông tin nhạy cảm đã bị loại khỏi payload AI',
    VALIDATION_FAILED: 'Dữ liệu gửi đi không hợp lệ',
    INTERNAL: 'Lỗi nội bộ; xem diagnostics để biết thêm',
    NETWORK: 'Lỗi mạng cục bộ',
  } as const,
} as const;

/** Stable lookup by error code (shared `ErrorCode` or 'NETWORK'). */
export function viError(code: string): string {
  return VI.errors[code as keyof typeof VI.errors] ?? VI.errors.INTERNAL;
}
