export declare const REPO_ROOT: string;
/** `<class>_<first 8 hex of sha256("<repo-relative path>:<class>")>`; `filename` is the absolute module path. */
export declare function scopedName(name: string, filename: string): string;
