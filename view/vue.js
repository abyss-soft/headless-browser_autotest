const { createApp } = Vue;

createApp({
  data() {
    return {
      rows: [],
      fileName: "",
      error: "",
    };
  },
  methods: {
    safeUrl(value) {
      try {
        const parsedUrl = new URL(value);
        return ["http:", "https:"].includes(parsedUrl.protocol)
          ? parsedUrl.href
          : null;
      } catch {
        return null;
      }
    },
    async loadFile(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      this.fileName = file.name;
      this.error = "";
      this.rows = [];

      try {
        const results = JSON.parse(await file.text());
        if (
          !Array.isArray(results) ||
          !results.every(
            (row) =>
              row &&
              typeof row.name === "string" &&
              typeof row.platform === "string" &&
              typeof row.measurement === "string" &&
              typeof row.url === "string" &&
              "amount" in row
          )
        ) {
          throw new Error("The selected file is not a PageSpeed result log.");
        }
        this.rows = results;
      } catch (error) {
        this.error = error.message;
      }
    },
    formatDate(timestamp) {
      const date = new Date(Number(timestamp) * 1000);
      return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
    },
  },
}).mount("#app");
