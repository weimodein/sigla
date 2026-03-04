import { useState, useEffect } from "react";
import { getUserStats } from "../../api/userApi.js";
import { getWordStats } from "../../api/wordApi.js";
import { getModelStats } from "../../api/modelApi.js";
import { Users, BookOpen, Cpu, ClipboardList } from "lucide-react";

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-xl shadow-sm p-6 flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={22} className="text-white" />
    </div>
    <div>
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

const Dashboard = () => {
  const [userStats, setUserStats] = useState(null);
  const [wordStats, setWordStats] = useState(null);
  const [modelStats, setModelStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [users, words, models] = await Promise.all([
          getUserStats(),
          getWordStats(),
          getModelStats(),
        ]);
        setUserStats(users);
        setWordStats(words);
        setModelStats(models);
      } catch (err) {
        setError("Failed to load dashboard stats");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
        {error}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">
          Overview of SIGLA system activity
        </p>
      </div>

      {/* User Stats */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Users
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Users"
          value={userStats?.total}
          icon={Users}
          color="bg-blue-900"
        />
        <StatCard
          title="Pending Requests"
          value={userStats?.pending}
          icon={ClipboardList}
          color="bg-yellow-500"
        />
        <StatCard
          title="Deactivated"
          value={userStats?.deactivated}
          icon={Users}
          color="bg-red-500"
        />
        <StatCard
          title="Administrators"
          value={userStats?.admins}
          icon={Users}
          color="bg-purple-600"
        />
      </div>

      {/* Word Stats */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Words
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Words"
          value={wordStats?.total}
          icon={BookOpen}
          color="bg-blue-900"
        />
        <StatCard
          title="Pending Approval"
          value={wordStats?.pending}
          icon={ClipboardList}
          color="bg-yellow-500"
        />
        <StatCard
          title="Approved"
          value={wordStats?.approved}
          icon={BookOpen}
          color="bg-green-500"
        />
        <StatCard
          title="Rejected"
          value={wordStats?.rejected}
          icon={BookOpen}
          color="bg-red-500"
        />
      </div>

      {/* Model Stats */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Model
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard
          title="Total Versions"
          value={modelStats?.total}
          icon={Cpu}
          color="bg-blue-900"
        />
        <StatCard
          title="Deployed"
          value={modelStats?.deployed}
          icon={Cpu}
          color="bg-green-500"
        />
        <StatCard
          title="Trained (not deployed)"
          value={modelStats?.trained}
          icon={Cpu}
          color="bg-yellow-500"
        />
      </div>

      {/* Current deployed model info */}
      {modelStats?.current_model && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Currently Deployed Model
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Version</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.version_number}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Accuracy</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.accuracy
                  ? `${(modelStats.current_model.accuracy * 100).toFixed(1)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Classes</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.total_classes ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Deployed At</p>
              <p className="font-semibold text-gray-800">
                {modelStats.current_model.deployed_at
                  ? new Date(
                      modelStats.current_model.deployed_at,
                    ).toLocaleDateString()
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
