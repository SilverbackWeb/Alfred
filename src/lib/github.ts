import { Octokit } from "octokit";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

/**
 * Lists all repositories for the authenticated user.
 */
export async function listUserRepos() {
  if (!GITHUB_TOKEN) return { error: "Missing GITHUB_TOKEN" };

  try {
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: "updated",
      direction: "desc",
      per_page: 20
    });
    return data.map(repo => ({
      name: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      stars: repo.stargazers_count,
      private: repo.private
    }));
  } catch (error) {
    console.error("GitHub List Repos Error:", error);
    return { error: "Failed to list repositories" };
  }
}

/**
 * Searches for repositories owned by the user or their organization.
 */
export async function searchUserRepos(query: string) {
  if (!GITHUB_TOKEN) return { error: "Missing GITHUB_TOKEN" };

  try {
    const { data } = await octokit.rest.search.repos({
      q: `${query} user:SilverbackWeb`,
      sort: "updated",
      order: "desc",
      per_page: 5
    });
    return data.items.map(repo => ({
      name: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      stars: repo.stargazers_count
    }));
  } catch (error) {
    console.error("GitHub Search Error:", error);
    return { error: "Failed to search repositories" };
  }
}

/**
 * Fetches issues for a specific repository.
 */
export async function getRepoIssues(owner: string, repo: string) {
  if (!GITHUB_TOKEN) return { error: "Missing GITHUB_TOKEN" };
  
  try {
    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      per_page: 10
    });
    return data.map(issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      author: issue.user?.login
    }));
  } catch (error) {
    console.error("GitHub Issues Error:", error);
    return { error: "Failed to fetch issues" };
  }
}

/**
 * Fetches recent notifications for the authenticated user.
 */
export async function getGitHubNotifications() {
  if (!GITHUB_TOKEN) return { error: "Missing GITHUB_TOKEN" };
  
  try {
    const { data } = await octokit.rest.activity.listNotificationsForAuthenticatedUser({
      all: false,
      participating: true,
      per_page: 5
    });
    return data.map(notif => ({
      id: notif.id,
      title: notif.subject.title,
      type: notif.subject.type,
      repo: notif.repository.full_name,
      reason: notif.reason
    }));
  } catch (error) {
    console.error("GitHub Notifications Error:", error);
    return { error: "Failed to fetch notifications" };
  }
}
