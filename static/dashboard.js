async function loadDashboard() {

    const loading = document.getElementById("loading");
    const dashboard = document.getElementById("dashboard");
    const error = document.getElementById("error");
    const errorMessage = document.getElementById("errorMessage");

    loading.classList.remove("hidden");
    dashboard.classList.add("hidden");
    error.classList.add("hidden");

    try {

        const response = await fetch("/dashboard");

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();

        renderDashboard(data);

        loading.classList.add("hidden");
        dashboard.classList.remove("hidden");

    } catch (err) {

        console.error(err);

        loading.classList.add("hidden");
        error.classList.remove("hidden");

        errorMessage.textContent = err.message;
    }
}


function renderDashboard(data) {

    document.getElementById("totalEmails").textContent =
        data.total_emails ?? 0;

    document.getElementById("actionRequired").textContent =
        data.action_required ?? 0;

    document.getElementById("highPriority").textContent =
        data.high_priority ?? 0;


    renderCategories(data.categories || {});

    renderUpcomingDeadlines(data.upcoming_deadlines || []);


    const recentEmails = data.recent_emails || [];

    renderAttention(recentEmails);

    renderEmails(recentEmails);
}


function renderCategories(categories) {

    const container = document.getElementById("categories");

    container.innerHTML = "";

    const categoryOrder = [
        "fees",
        "uniform",
        "event",
        "academic",
        "cafeteria",
        "announcement",
        "classroom",
        "homework",
        "other"
    ];

    categoryOrder.forEach(category => {

        const count = categories[category] ?? 0;

        const card = document.createElement("div");

        card.className = "category-card";

        card.innerHTML = `
            <div class="category-name">${escapeHtml(category)}</div>
            <div class="category-value">${count}</div>
        `;

        container.appendChild(card);
    });
}


function renderUpcomingDeadlines(deadlines) {

    const container = document.getElementById("deadlinesList");

    container.innerHTML = "";

    if (deadlines.length === 0) {

        container.innerHTML = `
            <div class="deadline-item">
                <div class="deadline-main">
                    <div class="deadline-subject">
                        No upcoming deadlines
                    </div>
                    <div class="deadline-sub">
                        Deadlines and event dates mentioned in your emails will show up here.
                    </div>
                </div>
            </div>
        `;

        return;
    }

    deadlines.forEach(item => {

        const row = document.createElement("div");

        row.className = "deadline-item";

        const relativeLabel = formatDaysUntil(item.days_until);

        const relativeClass =
            item.days_until < 0
                ? "deadline-overdue"
                : item.days_until <= 3
                    ? "deadline-soon"
                    : "deadline-upcoming";

        row.innerHTML = `
            <div class="deadline-main">

                <div class="deadline-subject">
                    ${escapeHtml(item.subject || "Untitled email")}
                </div>

                <div class="deadline-meta">

                    <span class="badge badge-category">
                        ${escapeHtml(item.category || "other")}
                    </span>

                    <span class="badge badge-deadline">
                        ${escapeHtml(item.date_type === "event" ? "Event" : "Deadline")}:
                        ${escapeHtml(item.target_date_display || "")}
                    </span>

                </div>

            </div>

            <div class="deadline-relative ${relativeClass}">
                ${escapeHtml(relativeLabel)}
            </div>
        `;

        container.appendChild(row);
    });
}


function formatDaysUntil(days) {

    if (days === 0) {
        return "Today";
    }

    if (days === 1) {
        return "Tomorrow";
    }

    if (days === -1) {
        return "Yesterday";
    }

    if (days > 1) {
        return `In ${days} days`;
    }

    return `Overdue by ${Math.abs(days)} days`;
}


function renderAttention(emails) {

    const container = document.getElementById("attentionList");

    container.innerHTML = "";

    const attentionEmails = emails
        .filter(email => email.action_required === true)
        .slice(0, 3);

    if (attentionEmails.length === 0) {

        container.innerHTML = `
            <div class="attention-item">
                <div class="attention-subject">
                    You're all caught up 🎉
                </div>

                <div class="attention-summary">
                    There are no emails currently requiring action.
                </div>
            </div>
        `;

        return;
    }


    attentionEmails.forEach(email => {

        const item = document.createElement("div");

        item.className =
            `attention-item ${email.priority === "high" ? "high" : ""}`;

        item.innerHTML = `
            <div class="attention-subject">
                ${escapeHtml(email.subject || "Untitled email")}
            </div>

            <div class="attention-summary">
                ${escapeHtml(email.summary || "")}
            </div>

            <div class="attention-meta">

                <span class="badge badge-${escapeHtml(email.priority || "low")}">
                    ${escapeHtml(email.priority || "low")}
                </span>

                <span class="badge badge-category">
                    ${escapeHtml(email.category || "other")}
                </span>

                <span class="badge badge-action">
                    Action required
                </span>

            </div>
        `;

        container.appendChild(item);
    });
}


function renderEmails(emails) {

    const container = document.getElementById("emailList");

    container.innerHTML = "";

    emails.slice(0, 3).forEach(email => {

        const row = document.createElement("div");

        row.className = "email-row";

        row.innerHTML = `

            <div class="email-main">

                <div class="email-subject">
                    ${escapeHtml(email.subject || "Untitled email")}
                </div>

                <div class="email-summary">
                    ${escapeHtml(email.summary || "")}
                </div>

                <div class="email-from">
                    ${escapeHtml(email.from || "")}${
                        email.date
                            ? ` · ${escapeHtml(formatEmailDateTime(email.date))}`
                            : ""
                    }
                </div>

            </div>


            <div class="email-meta">

                <span class="badge badge-category">
                    ${escapeHtml(email.category || "other")}
                </span>

                <span class="badge badge-${escapeHtml(email.priority || "low")}">
                    ${escapeHtml(email.priority || "low")}
                </span>

                ${
                    email.action_required
                        ? `<span class="badge badge-action">Action</span>`
                        : ""
                }

            </div>
        `;

        container.appendChild(row);
    });
}


function getEmailTimestamp(dateString) {

    if (!dateString) {
        return 0;
    }

    const parsed = new Date(dateString);

    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}


function formatEmailDateTime(dateString) {

    if (!dateString) {
        return "";
    }

    const parsed = new Date(dateString);

    if (isNaN(parsed.getTime())) {
        return dateString;
    }

    return parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}


function escapeHtml(value) {

    const div = document.createElement("div");

    div.textContent = value;

    return div.innerHTML;
}


document
    .getElementById("refreshButton")
    .addEventListener("click", loadDashboard);


function switchToView(view) {

    document.querySelectorAll(".nav-item").forEach(navItem => {
        navItem.classList.toggle("active", navItem.dataset.view === view);
    });

    if (view === "dashboard") {
        showDashboardView();
    }

    if (view === "emails") {
        showEmailsView();
    }

    if (view === "classroom") {
        showClassroomView();
    }

    if (view === "homework") {
        showHomeworkView();
    }

    if (view === "action") {
        showActionView();
    }

    if (view === "settings") {
        showSettingsView();
    }
}


document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", function (event) {
        event.preventDefault();
        switchToView(this.dataset.view);
    });
});


document
    .getElementById("attentionViewAll")
    .addEventListener("click", function (event) {
        event.preventDefault();
        switchToView("action");
    });


document
    .getElementById("recentEmailsViewAll")
    .addEventListener("click", function (event) {
        event.preventDefault();
        switchToView("emails");
    });


function showDashboardView() {

    document.querySelector(".topbar h1").textContent = "Dashboard";

    document.querySelector(".topbar p").textContent =
        "Your school's latest information at a glance.";

    document
        .querySelectorAll("#dashboard > .section")
        .forEach(section => {
            section.classList.remove("hidden");
        });

    document.getElementById("emailsView").classList.add("hidden");

    document.getElementById("classroomView").classList.add("hidden");

    document.getElementById("homeworkView").classList.add("hidden");

    document.getElementById("actionView").classList.add("hidden");

    document.getElementById("settingsView").classList.add("hidden");

}


async function showEmailsView() {

    document.querySelector(".topbar h1").textContent = "Emails";

    document.querySelector(".topbar p").textContent =
        "All of your processed school emails.";

    document.getElementById("dashboard").classList.remove("hidden");

    document
        .querySelectorAll("#dashboard > .section")
        .forEach(section => {
            section.classList.add("hidden");
        });

    document.getElementById("classroomView").classList.add("hidden");

    document.getElementById("homeworkView").classList.add("hidden");

    document.getElementById("actionView").classList.add("hidden");

    document.getElementById("settingsView").classList.add("hidden");

    document.getElementById("emailsView").classList.remove("hidden");

    await loadAllEmails();

}


async function showClassroomView() {

    document.querySelector(".topbar h1").textContent = "Classroom";

    document.querySelector(".topbar p").textContent =
        "Posts and materials from Google Classroom.";

    document.getElementById("dashboard").classList.remove("hidden");

    document
        .querySelectorAll("#dashboard > .section")
        .forEach(section => {
            section.classList.add("hidden");
        });

    document.getElementById("emailsView").classList.add("hidden");

    document.getElementById("homeworkView").classList.add("hidden");

    document.getElementById("actionView").classList.add("hidden");

    document.getElementById("settingsView").classList.add("hidden");

    document.getElementById("classroomView").classList.remove("hidden");

    await classroomListView.load();

}


async function showHomeworkView() {

    document.querySelector(".topbar h1").textContent = "Homework";

    document.querySelector(".topbar p").textContent =
        "Assigned work from your child's classes.";

    document.getElementById("dashboard").classList.remove("hidden");

    document
        .querySelectorAll("#dashboard > .section")
        .forEach(section => {
            section.classList.add("hidden");
        });

    document.getElementById("emailsView").classList.add("hidden");

    document.getElementById("classroomView").classList.add("hidden");

    document.getElementById("actionView").classList.add("hidden");

    document.getElementById("settingsView").classList.add("hidden");

    document.getElementById("homeworkView").classList.remove("hidden");

    await homeworkListView.load();

}


async function showActionView() {

    document.querySelector(".topbar h1").textContent =
        "Action Required";

    document.querySelector(".topbar p").textContent =
        "Emails that require your attention.";

    document.getElementById("dashboard").classList.remove("hidden");

    document
        .querySelectorAll("#dashboard > .section")
        .forEach(section => {
            section.classList.add("hidden");
        });

    document.getElementById("emailsView").classList.add("hidden");

    document.getElementById("classroomView").classList.add("hidden");

    document.getElementById("homeworkView").classList.add("hidden");

    document.getElementById("actionView").classList.remove("hidden");

    document.getElementById("settingsView").classList.add("hidden");

    await actionListView.load();

}

function showSettingsView() {

    document.querySelector(".topbar h1").textContent = "Settings";

    document.querySelector(".topbar p").textContent =
        "Manage your School Assistant settings.";

    // Hide dashboard sections
    document
        .querySelectorAll("#dashboard > .section")
        .forEach(section => {
            section.classList.add("hidden");
        });

    // Hide other views if they exist
    const emailsView = document.getElementById("emailsView");
    const classroomView = document.getElementById("classroomView");
    const homeworkView = document.getElementById("homeworkView");
    const actionView = document.getElementById("actionView");
    const settingsView = document.getElementById("settingsView");

    if (emailsView) {
        emailsView.classList.add("hidden");
    }

    if (classroomView) {
        classroomView.classList.add("hidden");
    }

    if (homeworkView) {
        homeworkView.classList.add("hidden");
    }

    if (actionView) {
        actionView.classList.add("hidden");
    }

    // Show settings
    if (settingsView) {
        settingsView.classList.remove("hidden");
    } else {
        console.error("settingsView element not found");
    }
}
let allEmails = [];


async function loadAllEmails() {

    const container = document.getElementById("allEmailsList");

    container.innerHTML = `
        <div class="loading">
            Loading emails...
        </div>
    `;

    try {

        const response = await fetch("/emails");

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();

        allEmails = data.emails || [];

        allEmails.sort(
            (a, b) => getEmailTimestamp(b.date) - getEmailTimestamp(a.date)
        );

        renderAllEmails();

    } catch (err) {

        console.error("Failed to load emails:", err);

        container.innerHTML = `
            <div class="error">
                <h3>Unable to load emails</h3>
                <p>${escapeHtml(err.message)}</p>
            </div>
        `;

    }

}


function renderAllEmails() {

    const container = document.getElementById("allEmailsList");

    const searchValue =
        document
            .getElementById("emailSearch")
            .value
            .toLowerCase()
            .trim();

    const category =
        document.getElementById("categoryFilter").value;

    const priority =
        document.getElementById("priorityFilter").value;


    const filteredEmails = allEmails.filter(email => {

        const matchesSearch =
            !searchValue ||
            (email.subject || "").toLowerCase().includes(searchValue) ||
            (email.summary || "").toLowerCase().includes(searchValue) ||
            (email.from || "").toLowerCase().includes(searchValue);

        const matchesCategory =
            category === "all" ||
            email.category === category;

        const matchesPriority =
            priority === "all" ||
            email.priority === priority;

        return (
            matchesSearch &&
            matchesCategory &&
            matchesPriority
        );

    });


    document.getElementById("allEmailCount").textContent =
        `${filteredEmails.length} of ${allEmails.length} emails`;


    if (filteredEmails.length === 0) {

        container.innerHTML = `
            <div class="empty-state">

                <div class="empty-state-icon">
                    ✉
                </div>

                <div class="empty-state-title">
                    No emails found
                </div>

                <div class="empty-state-text">
                    Try changing your search or filters.
                </div>

            </div>
        `;

        return;

    }


    container.innerHTML = "";


    filteredEmails.forEach(email => {

        const row = document.createElement("div");

        row.className = "email-row";


        row.innerHTML = `

            <div class="email-main">

                <div class="email-subject">
                    ${escapeHtml(
                        email.subject || "Untitled email"
                    )}
                </div>

                <div class="email-summary">
                    ${escapeHtml(
                        email.summary || ""
                    )}
                </div>

                <div class="email-from">
                    ${escapeHtml(
                        email.from || ""
                    )}${
                        email.date
                            ? ` · ${escapeHtml(formatEmailDateTime(email.date))}`
                            : ""
                    }
                </div>

            </div>


            <div class="email-meta">

                <span class="badge badge-category">
                    ${escapeHtml(
                        email.category || "other"
                    )}
                </span>

                <span class="badge badge-${escapeHtml(
                    email.priority || "low"
                )}">
                    ${escapeHtml(
                        email.priority || "low"
                    )}
                </span>

                ${
                    email.action_required
                        ? `<span class="badge badge-action">
                               Action
                           </span>`
                        : ""
                }

                ${
                    email.gmail_url
                        ? `<a class="open-email-link" href="${escapeHtml(email.gmail_url)}" target="_blank" rel="noopener noreferrer">→ Open email</a>`
                        : ""
                }

            </div>

        `;


        container.appendChild(row);

    });

}

function formatCompletedDate(isoString) {

    try {

        const date = new Date(isoString);

        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric"
        });

    } catch (err) {

        return isoString;

    }

}


function showListError(item, message) {

    if (!item) {
        return;
    }

    let errorEl = item.querySelector(".action-error");

    if (!errorEl) {

        errorEl = document.createElement("div");
        errorEl.className = "action-error";

        item.appendChild(errorEl);

    }

    errorEl.textContent = `Unable to update: ${message}`;

}


// Powers Action Required, Classroom, and Homework, which all share the same
// Open/Completed tabbed layout and differ only in which emails they show.
function createTabbedEmailList({ listId, countId, filterFn, emptyMessages }) {

    const listEl = document.getElementById(listId);
    const countEl = document.getElementById(countId);
    const tabs = listEl.closest(".section").querySelectorAll(".action-tab");

    let openEmails = [];
    let completedEmails = [];
    let activeTab = "open";

    async function load() {

        listEl.innerHTML = `
            <div class="loading">
                Loading...
            </div>
        `;

        try {

            const response = await fetch("/emails");

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            const data = await response.json();

            const matching = (data.emails || []).filter(filterFn);

            openEmails = matching.filter(
                email => email.action_status !== "completed"
            );

            completedEmails = matching.filter(
                email => email.action_status === "completed"
            );

            render();

        } catch (err) {

            console.error(`Failed to load ${listId}:`, err);

            listEl.innerHTML = `
                <div class="error">
                    <h3>Unable to load items</h3>
                    <p>${escapeHtml(err.message)}</p>
                </div>
            `;

        }

    }

    function render() {

        const emails =
            activeTab === "completed" ? completedEmails : openEmails;

        const priorityOrder = { high: 1, medium: 2, low: 3 };

        if (activeTab === "completed") {

            emails.sort((a, b) =>
                (b.completed_at || "").localeCompare(a.completed_at || "")
            );

        } else {

            emails.sort((a, b) =>
                (priorityOrder[a.priority] || 99) -
                (priorityOrder[b.priority] || 99)
            );

        }

        countEl.textContent =
            `${emails.length} ${emails.length === 1 ? "item" : "items"}`;

        if (emails.length === 0) {

            const empty =
                activeTab === "completed"
                    ? emptyMessages.completed
                    : emptyMessages.open;

            listEl.innerHTML = `
                <div class="attention-item">
                    <div class="attention-subject">${escapeHtml(empty.title)}</div>
                    <div class="attention-summary">${escapeHtml(empty.text)}</div>
                </div>
            `;

            return;

        }

        listEl.innerHTML = "";

        emails.forEach(email => {

            const item = document.createElement("div");

            item.className =
                `attention-item ${email.priority === "high" ? "high" : ""}`;

            item.dataset.emailId = email.firestore_id || "";

            const actionButton =
                activeTab === "completed"
                    ? `<button type="button" class="complete-action-button" data-action="reopen" data-email-id="${escapeHtml(email.firestore_id)}">↩ Reopen</button>`
                    : `<button type="button" class="complete-action-button" data-action="complete" data-email-id="${escapeHtml(email.firestore_id)}">✓ Mark as done</button>`;

            item.innerHTML = `

                <div class="attention-subject">
                    ${escapeHtml(email.subject || "Untitled email")}
                </div>

                <div class="attention-summary">
                    ${escapeHtml(email.summary || "")}
                </div>

                <div class="attention-meta">

                    <span class="badge badge-${escapeHtml(email.priority || "low")}">
                        ${escapeHtml(email.priority || "low")}
                    </span>

                    <span class="badge badge-category">
                        ${escapeHtml(email.category || "other")}
                    </span>

                    ${
                        activeTab === "completed"
                            ? (
                                email.completed_at
                                    ? `<span class="badge badge-category">Completed ${escapeHtml(formatCompletedDate(email.completed_at))}</span>`
                                    : ""
                            )
                            : (
                                email.action_required
                                    ? `<span class="badge badge-action">Action required</span>`
                                    : ""
                            )
                    }

                    ${
                        email.deadline
                            ? `<span class="badge badge-deadline">Deadline: ${escapeHtml(email.deadline)}</span>`
                            : ""
                    }

                    ${actionButton}

                    ${
                        email.gmail_url
                            ? `<a class="open-email-link" href="${escapeHtml(email.gmail_url)}" target="_blank" rel="noopener noreferrer">→ Open email</a>`
                            : ""
                    }

                </div>

            `;

            listEl.appendChild(item);

        });

    }

    async function completeItem(emailId, button) {

        if (button.disabled) {
            return;
        }

        button.disabled = true;

        const originalText = button.textContent;

        button.textContent = "Completing...";

        const item = button.closest(".attention-item");

        try {

            const response = await fetch(
                `/emails/${encodeURIComponent(emailId)}/complete`,
                { method: "POST" }
            );

            const data = await response.json();

            if (!response.ok || data.status !== "ok") {
                throw new Error(
                    data.error || `Server returned ${response.status}`
                );
            }

            button.textContent = "✓ Completed";

            if (item) {
                item.classList.add("completing");
            }

            const index = openEmails.findIndex(
                email => email.firestore_id === emailId
            );

            if (index !== -1) {

                const [email] = openEmails.splice(index, 1);

                email.action_status = "completed";
                email.completed_at = data.completed_at;

                completedEmails.unshift(email);

            }

            setTimeout(render, 450);

        } catch (err) {

            console.error("Failed to complete item:", err);

            button.disabled = false;
            button.textContent = originalText;

            showListError(item, err.message);

        }

    }

    async function reopenItem(emailId, button) {

        if (button.disabled) {
            return;
        }

        button.disabled = true;

        const originalText = button.textContent;

        button.textContent = "Reopening...";

        const item = button.closest(".attention-item");

        try {

            const response = await fetch(
                `/emails/${encodeURIComponent(emailId)}/reopen`,
                { method: "POST" }
            );

            const data = await response.json();

            if (!response.ok || data.status !== "ok") {
                throw new Error(
                    data.error || `Server returned ${response.status}`
                );
            }

            const index = completedEmails.findIndex(
                email => email.firestore_id === emailId
            );

            if (index !== -1) {

                const [email] = completedEmails.splice(index, 1);

                email.action_status = "open";
                email.completed_at = null;

                openEmails.push(email);

            }

            render();

        } catch (err) {

            console.error("Failed to reopen item:", err);

            button.disabled = false;
            button.textContent = originalText;

            showListError(item, err.message);

        }

    }

    listEl.addEventListener("click", function (event) {

        const button = event.target.closest(".complete-action-button");

        if (!button) {
            return;
        }

        const emailId = button.dataset.emailId;
        const action = button.dataset.action;

        if (action === "complete") {
            completeItem(emailId, button);
        } else if (action === "reopen") {
            reopenItem(emailId, button);
        }

    });

    tabs.forEach(tab => {

        tab.addEventListener("click", function () {

            tabs.forEach(t => t.classList.remove("active"));

            this.classList.add("active");

            activeTab = this.dataset.actionTab;

            render();

        });

    });

    return { load };

}


const actionListView = createTabbedEmailList({
    listId: "actionEmailsList",
    countId: "actionEmailCount",
    filterFn: email => email.action_required === true,
    emptyMessages: {
        open: {
            title: "You're all caught up 🎉",
            text: "There are no emails currently requiring action."
        },
        completed: {
            title: "Nothing completed yet",
            text: "Actions you mark as done will show up here."
        }
    }
});


const classroomListView = createTabbedEmailList({
    listId: "classroomEmailsList",
    countId: "classroomEmailCount",
    filterFn: email => email.category === "classroom",
    emptyMessages: {
        open: {
            title: "No new classroom posts",
            text: "New Google Classroom posts will show up here."
        },
        completed: {
            title: "Nothing marked as done yet",
            text: "Classroom posts you mark as done will show up here."
        }
    }
});


const homeworkListView = createTabbedEmailList({
    listId: "homeworkEmailsList",
    countId: "homeworkEmailCount",
    filterFn: email => email.category === "homework",
    emptyMessages: {
        open: {
            title: "No homework right now 🎉",
            text: "Assigned homework will show up here."
        },
        completed: {
            title: "No homework completed yet",
            text: "Homework you mark as done will show up here."
        }
    }
});

async function processNewEmails() {

    const button =
        document.getElementById("processEmailsButton");

    const message =
        document.getElementById("settingsMessage");

    button.disabled = true;
    button.textContent = "Fetching...";

    message.classList.add("hidden");

    try {

        const response = await fetch("/process");

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || `Server returned ${response.status}`
            );
        }

        message.className =
            "settings-message settings-message-success";

        message.textContent =
            `Email sync complete. ${data.new ?? 0} new email(s) found, ` +
            `${data.existing ?? 0} already existed.`;

    } catch (err) {

        console.error(err);

        message.className =
            "settings-message settings-message-error";

        message.textContent =
            `Unable to fetch emails: ${err.message}`;

    } finally {

        button.disabled = false;
        button.textContent = "↻ Fetch New Emails";

    }

}

async function processWithAi() {

    const button =
        document.getElementById("processAiButton");

    const message =
        document.getElementById("settingsMessage");

    button.disabled = true;
    button.textContent = "Processing...";

    message.classList.add("hidden");

    try {

        const response = await fetch("/process-ai");

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || `Server returned ${response.status}`
            );
        }

        message.className =
            "settings-message settings-message-success";

        message.textContent =
            `AI processing complete. ` +
            `${data.processed ?? 0} processed, ` +
            `${data.skipped ?? 0} skipped.`;

        await loadDashboard();

    } catch (err) {

        console.error(err);

        message.className =
            "settings-message settings-message-error";

        message.textContent =
            `AI processing failed: ${err.message}`;

    } finally {

        button.disabled = false;
        button.textContent = "✦ Process with AI";

    }

}

document
    .getElementById("emailSearch")
    .addEventListener("input", renderAllEmails);


document
    .getElementById("categoryFilter")
    .addEventListener("change", renderAllEmails);


document
    .getElementById("priorityFilter")
    .addEventListener("change", renderAllEmails);

document
    .getElementById("processEmailsButton")
    .addEventListener("click", processNewEmails);


document
    .getElementById("processAiButton")
    .addEventListener("click", processWithAi);

loadDashboard();