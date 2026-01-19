-- Table for raw scraped posts
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    image_url TEXT,
    caption TEXT,
    post_url TEXT,
    timestamp TEXT,
    processed BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table for extracted event information
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT,
    title TEXT,
    description TEXT,
    event_date TEXT,
    event_time TEXT,
    post_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id)
);
