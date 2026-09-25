using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;

namespace Arena.Agent.Windows;

/// <summary>
/// The device's enrolment private key (ECDSA P-256). Encrypted with DPAPI in
/// machine scope — it can only be decrypted on this PC — and the file is
/// restricted to SYSTEM and Administrators, so a gamer on a kiosk account
/// cannot read or copy it. (TPM-backed CNG keys are the next hardening step.)
/// </summary>
public static class KeyStore
{
    private static readonly byte[] Entropy = "ArenaOS.Agent.DeviceKey.v1"u8.ToArray();

    public static ECDsa CreateAndSave(string path)
    {
        var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var sealedBytes = ProtectedData.Protect(key.ExportPkcs8PrivateKey(), Entropy, DataProtectionScope.LocalMachine);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, sealedBytes);
        Restrict(path);
        return key;
    }

    public static ECDsa Load(string path)
    {
        var plain = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.LocalMachine);
        try
        {
            var key = ECDsa.Create();
            key.ImportPkcs8PrivateKey(plain, out _);
            return key;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    /// <summary>SYSTEM + Administrators only, no inheritance. Best effort when not elevated (dev).</summary>
    private static void Restrict(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            var acl = new FileSecurity();
            acl.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, AccessControlType.Allow));
            if (!IsElevated()) acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User!, FileSystemRights.FullControl, AccessControlType.Allow));
            fi.SetAccessControl(acl);
        }
        catch (UnauthorizedAccessException)
        {
            // Dev machines without elevation keep default ACLs; DPAPI still protects the key.
        }
    }

    public static bool IsElevated() => new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
}
